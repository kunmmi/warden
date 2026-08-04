/**
 * Deterministic policy layer — and its posture DEPENDS ON THE RAIL, which is
 * the single most important thing to understand about this file.
 *
 * ON THE EVM RAIL (swap / vault / transfer) it is a MIRROR of the on-chain
 * Kernel session-key policies: the on-chain caps are the hard wall; this layer
 * exists to reject bad intents cheaply and log WHY, before gas is spent. If
 * this code and the on-chain policy ever disagree, the on-chain policy wins
 * and that divergence is a bug to alert on. A mirror must never be stricter
 * than the chain — a stricter mirror rejects trades the wall would allow.
 *
 * ON THE BROKER RAIL (equity-order) there is NO on-chain policy to mirror.
 * Robinhood's Agentic account is custodial, its OAuth scope cannot be
 * restricted below full trading, and nothing re-checks amounts after this
 * function returns ok — so here this layer IS the wall, and the posture
 * inverts: deliberately conservative, because there is no backstop to defer
 * to. The only enforcement beneath it is Robinhood's own account-level
 * reserved budget. This is why processIntent runs checkPolicy TWICE on that
 * rail — once on the proposed notional and again on the terms review()
 * returns — where the EVM rail relies on the account contract for the
 * re-check. (spikes/robinhood-mcp/DESIGN.md §5.)
 *
 * Nothing in this file may call an LLM, read agent memory, or take a string that
 * originated from a model. Intents come in typed; verdicts go out typed.
 */

import { scoutAllows, type ScoutLimits } from "./quarantine";

export interface AgentLimits {
  /** USDG (6dp) ceiling for a single trade. */
  perTradeUsdg: bigint;
  /** USDG (6dp) ceiling summed over a rolling 24h window. */
  dailyUsdg: bigint;
  /** Allowed target contracts (Rialto router via registry, Morpho vault, tokens for approvals). */
  allowedTargets: readonly `0x${string}`[];
  /** Allowed token addresses the agent may hold or trade. */
  allowedAssets: readonly `0x${string}`[];
  /**
   * Token addresses the SIGNED KEY can actually approve for a sell — i.e. what
   * it can get back OUT of. Distinct from allowedAssets, which is only what the
   * owner pointed the agent at.
   *
   * These diverge for a real and previously costly reason: approving USDG is a
   * single generic permission, so a BUY works for any token with a pool, while
   * a SELL needs a per-token approve baked into the signature at signing time.
   * A token in the first set but not the second is a one-way door.
   *
   * Undefined disables the check — for callers (backtests, fixtures) that have
   * no grant to reason about. Never leave it undefined on a live path.
   */
  sellableAssets?: readonly string[];
  /**
   * Tickers the agent may trade on the brokerage rail — the broker analog of
   * allowedAssets, since an equity order has no address for that list to
   * check. Optional for fixtures only (the sellableAssets rule); on a live
   * broker path this IS the asset wall, so never leave it undefined there.
   */
  allowedTickers?: readonly string[];
  /**
   * Addresses this grant's wall permits USDG transfers to, mirroring the
   * on-chain ONE_OF pin. An EMPTY array means the wall has no transfer
   * permission at all; UNDEFINED means the grant predates the allowlist and
   * still carries the old free-form permission — the two are different, and
   * conflating them would make this mirror stricter than the chain.
   */
  withdrawalAddresses?: readonly string[];
  /** Drawdown (bps from high-water mark) at which the breaker pauses the agent. */
  maxDrawdownBps: number;
  /** Unix seconds after which the session key is dead regardless of anything. */
  expiresAt: number;
  /** Ops ceiling per rolling 24h — mirrors the on-chain rate-limit policy. */
  maxOpsPerDay: number;
}

export type TradeIntent = {
  /**
   * Opaque link to the `decisions` row that produced this intent — set upstream
   * (strategist / chat / tick fallback), stamped onto the trade for attribution.
   * checkPolicy MUST ignore it: this stays a numbers-only decision. It is NOT the
   * model's reason (that free text lives only in the decisions table, never here),
   * so the policy-purity rule above is preserved.
   */
  decisionId?: string;
} & ({
  kind: "swap";
  target: `0x${string}`;
  sellToken: `0x${string}`;
  buyToken: `0x${string}`;
  /** Raw units of sellToken (USDG = 6dp, stock tokens = 18dp) — what executes. */
  sellAmountRaw: bigint;
  /** USDG-equivalent size (6dp) — what the caps judge. */
  notionalUsdg: bigint;
} | {
  kind: "vault-deposit" | "vault-withdraw";
  target: `0x${string}`;
  amountUsdg: bigint;
} | {
  /**
   * USDG leaving the wall to an external recipient (chat /transfer, confirmed).
   * target is the USDG token contract; the recipient is free-form but the
   * amount is capped on-chain by the grant's transfer permission and here by
   * the same per-trade/daily caps as any spend.
   */
  kind: "transfer";
  target: `0x${string}`;
  recipient: `0x${string}`;
  amountUsdg: bigint;
} | {
  /**
   * A brokerage equity order (the Robinhood venue). NO ADDRESS FIELDS on
   * purpose: there is no contract to target and no calldata to build, and
   * omitting `target` means the compiler forces every consumer that assumes an
   * EVM shape to decide what an equity order means to it — nothing falls
   * through an else-branch built for chains.
   */
  kind: "equity-order";
  /** Uppercase ticker as the broker knows it (AAPL), never an address. */
  ticker: string;
  side: "buy" | "sell";
  /** USD notional, 6dp — same unit as USDG, judged by the same caps. */
  notionalUsdg: bigint;
});

export type Verdict =
  | { ok: true }
  | { ok: false; rule: string; detail: string };

export interface AgentState {
  spentTodayUsdg: bigint;
  /** Executed operations in the trailing 24h — mirrors the on-chain rate limit. */
  opsToday: number;
  highWaterMarkUsdg: bigint;
  equityUsdg: bigint;
  /**
   * Is `equityUsdg` the WHOLE book? False when a held asset couldn't be valued
   * this tick, in which case the figure is a partial sum — lower than reality,
   * not equal to it.
   *
   * The drawdown rule must not run on a partial total. Doing so reads the
   * missing asset as a loss and rejects every intent, INCLUDING the sell that
   * would clear the position — the agent locks itself in precisely when the
   * owner most needs it to act. Absent = true, so existing callers keep today's
   * behaviour; only a caller that KNOWS the book is short passes false.
   */
  equityKnown?: boolean;
  nowSec: number;
}

/**
 * Everything the scout ceiling needs, supplied BY THE CALLER, never by the intent.
 *
 * That separation is the point. Intents come from strategies, including
 * user-written ones in ~/.warden/strategies, so a flag carried on the intent
 * saying "this token is priceable" would be a flag a strategy could simply set —
 * and the budget on unpriceable positions would be bypassable by the very code
 * it exists to bound. Only the tick knows what it managed to price, so only the
 * tick gets to say.
 *
 * Absent = no scout gating, matching the behaviour before scout mode existed.
 * That is right for backtests and fixtures, which have no live price map. NEVER
 * leave it absent on a live path: an unpriceable buy would then be limited only
 * by the per-trade cap, which is exactly the hole this closes.
 */
export interface ScoutContext {
  limits: ScoutLimits;
  /** Did the tick fail to price the token being BOUGHT this cycle? */
  buyUnpriceable: boolean;
  /** USDG (6dp) already sunk into that same token. */
  existingCostUsdg: bigint;
  /** USDG (6dp) total across every unpriceable position held. */
  quarantinedUsdg: bigint;
}

export function checkPolicy(
  intent: TradeIntent,
  limits: AgentLimits,
  state: AgentState,
  scout?: ScoutContext,
): Verdict {
  if (state.nowSec >= limits.expiresAt) {
    return { ok: false, rule: "expiry", detail: "session key expired" };
  }

  const lc = (a: string) => a.toLowerCase();
  // Equity orders have no contract target — their allowlist is tickers, below.
  if (intent.kind !== "equity-order" && !limits.allowedTargets.map(lc).includes(lc(intent.target))) {
    return { ok: false, rule: "target-allowlist", detail: `target ${intent.target} not allowed` };
  }

  if (intent.kind === "equity-order") {
    if (intent.notionalUsdg <= 0n) {
      return { ok: false, rule: "order-amount", detail: "order notional must be positive" };
    }
    // Ticker allowlist — the broker rail's analog of allowedAssets. Optional
    // for the same reason sellableAssets is (backtests and fixtures have no
    // grant to reason about); NEVER leave it undefined on a live broker path.
    // Step 4 of the adapter plan makes it a first-class part of the retyped
    // limits — until then this is the whole asset wall on this rail.
    if (limits.allowedTickers) {
      const up = intent.ticker.toUpperCase();
      if (!limits.allowedTickers.some((t) => t.toUpperCase() === up)) {
        return { ok: false, rule: "ticker-allowlist", detail: `ticker ${intent.ticker} not allowed` };
      }
    }
  }

  if (intent.kind === "swap") {
    for (const token of [intent.sellToken, intent.buyToken]) {
      if (!limits.allowedAssets.map(lc).includes(lc(token))) {
        return { ok: false, rule: "asset-allowlist", detail: `asset ${token} not allowed` };
      }
    }

    // NEVER ENTER A POSITION THE KEY CANNOT EXIT.
    //
    // Buying spends USDG, which every grant can approve generically; selling
    // needs a per-token approve sealed into the signature. So a token with a
    // live pool but no approve permission buys fine and can never be sold —
    // the exit reverts at the wall, and no cap or breaker helps, because the
    // owner's money is in an asset the agent has no way to give back.
    //
    // This is checked here rather than left to the on-chain policy on purpose:
    // on-chain, the failure lands on the SELL, long after the buy succeeded and
    // the position exists. Refusing the buy is the only moment it's still free.
    //
    // Sells are never blocked by this rule — an exit must always be attemptable.
    if (limits.sellableAssets) {
      const sellable = limits.sellableAssets.map(lc);
      if (!sellable.includes(lc(intent.buyToken))) {
        return {
          ok: false,
          rule: "no-exit",
          detail:
            `refusing to buy ${intent.buyToken}: this key can't approve it for a sell, ` +
            `so the position could be opened and never closed. Re-sign the grant at /grant to cover it.`,
        };
      }
    }

    // BUYING SOMETHING NOBODY CAN PRICE.
    //
    // A token the tick couldn't value is one whose worth is genuinely unknown:
    // its pool is too new or too thin for a TWAP anyone should trust. The
    // drawdown breaker cannot protect that money, because protecting it would
    // mean believing the price it just refused. So the scout BUDGET is the only
    // control there is, and it has to bite here — before the position exists.
    //
    // Sells are untouched: this whole branch only ever inspects buyToken, so
    // getting OUT of an unpriceable position is never blocked by it.
    if (scout?.buyUnpriceable) {
      const verdict = scoutAllows(
        {
          spendUsdg: intent.notionalUsdg,
          existingCostUsdg: scout.existingCostUsdg,
          quarantinedUsdg: scout.quarantinedUsdg,
        },
        scout.limits,
      );
      if (!verdict.ok) return { ok: false, rule: "scout-budget", detail: verdict.reason };
    }
  }

  if (intent.kind === "transfer") {
    // Must at least be a plausible address — garbage never reaches calldata.
    if (!/^0x[0-9a-fA-F]{40}$/.test(intent.recipient)) {
      return { ok: false, rule: "transfer-recipient", detail: `recipient ${intent.recipient} is not an address` };
    }
    // MIRROR of the on-chain withdrawal allowlist. The wall now pins the USDG
    // transfer recipient to the addresses the owner registered at signing, and
    // carries no transfer permission at all when none were. Checking it here
    // too costs nothing and turns an opaque on-chain revert into a sentence
    // that says what to do — the same reason the rest of this file exists.
    //
    // Undefined means "this grant predates the allowlist", NOT "allow
    // anything": such a grant genuinely has the old free-form permission, and
    // a mirror stricter than the chain would reject trades the wall permits.
    if (limits.withdrawalAddresses) {
      if (limits.withdrawalAddresses.length === 0) {
        return {
          ok: false,
          rule: "transfer-not-permitted",
          detail:
            "this wall carries no transfer permission — no withdrawal addresses were registered when it was signed. " +
            "Re-sign the grant with a destination, or move funds with your owner key (`merrymen recover`).",
        };
      }
      const to = intent.recipient.toLowerCase();
      if (!limits.withdrawalAddresses.some((a) => a.toLowerCase() === to)) {
        return {
          ok: false,
          rule: "transfer-recipient-allowlist",
          detail: `${intent.recipient} is not one of the registered withdrawal addresses on this wall`,
        };
      }
    }
    if (intent.amountUsdg <= 0n) {
      return { ok: false, rule: "transfer-amount", detail: "transfer amount must be positive" };
    }
  }

  if (state.opsToday >= limits.maxOpsPerDay) {
    return { ok: false, rule: "ops-cap", detail: `${state.opsToday} ops in 24h >= ${limits.maxOpsPerDay}` };
  }

  // Per-op size ceiling — mirrors the on-chain call policy EXACTLY, because a
  // stricter mirror rejects trades the chain would happily allow (a real bug per
  // this file's contract). On-chain (web/src/lib/session.ts):
  //   • swaps & transfers  → approve/transfer USDG capped at the PER-TRADE limit
  //   • vault deposits      → capped at the DAILY limit (parking idle cash in the
  //                           Morpho vault isn't a market spend; it's reversible)
  //   • vault withdrawals   → unsized (funds return to the account)
  // The old mirror capped deposits at the per-trade limit, so a large idle-cash
  // sweep (e.g. 80 USDG with a 30-USDG per-trade cap) was rejected every tick
  // while the chain would have accepted it.
  if (intent.kind !== "vault-withdraw") {
    // Equity orders count on BOTH sides, like swaps: a sell is still an op and
    // still market exposure, and on this rail these caps are the only wall.
    const notional =
      intent.kind === "swap" || intent.kind === "equity-order" ? intent.notionalUsdg : intent.amountUsdg;
    const isDeposit = intent.kind === "vault-deposit";
    const perOpCap = isDeposit ? limits.dailyUsdg : limits.perTradeUsdg;
    if (notional > perOpCap) {
      return {
        ok: false,
        rule: isDeposit ? "deposit-cap" : "per-trade-cap",
        detail: `${notional} > ${perOpCap}`,
      };
    }
    if (state.spentTodayUsdg + notional > limits.dailyUsdg) {
      return { ok: false, rule: "daily-cap", detail: `would exceed daily cap ${limits.dailyUsdg}` };
    }
  }

  // Unknown equity is not low equity. Every other rule above still applies —
  // caps, allowlists, expiry, budgets — but a drawdown can only be measured
  // against a book we can actually total.
  if (state.highWaterMarkUsdg > 0n && state.equityKnown !== false) {
    const drawdownBps = Number(
      ((state.highWaterMarkUsdg - state.equityUsdg) * 10_000n) / state.highWaterMarkUsdg,
    );
    if (drawdownBps >= limits.maxDrawdownBps) {
      return { ok: false, rule: "drawdown-breaker", detail: `${drawdownBps}bps >= ${limits.maxDrawdownBps}bps` };
    }
  }

  return { ok: true };
}
