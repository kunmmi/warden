/**
 * trencher — buying newly launched tokens, and knowing when to leave.
 *
 * WHAT THIS IS NOT. It is not alpha. Nothing in here knows which memecoin goes
 * up, and any code claiming otherwise would be lying to whoever runs it. What it
 * is: a risk FILTER with an exit discipline, over signals that are read from the
 * chain and checkable by anyone — depth, fully diluted value, age, drawdown from
 * entry, and how much liquidity has left since. No provider's score, no
 * "trending" list, nothing a promoter can manufacture.
 *
 * THE ASYMMETRY IS THE DESIGN. Entering requires EVERY condition to hold.
 * Leaving requires only ONE to break. That is deliberate and it is not
 * balanced-looking on purpose: losing money is far easier than making it, the
 * failure modes here are abrupt (liquidity pulled, price gone in one block), and
 * a filter that hesitates on the way out is worse than one that never entered.
 *
 * THE HONEST EXPECTATION. Most tokens this sees will fail its entry filter, and
 * most that pass will still lose money. It is sized by the scout budget for
 * exactly that reason — the budget is the risk control, not the analysis.
 *
 * KNOWN COVERAGE GAP (measured live, 2026-09-05). Discovery finds new pairs on
 * both PancakeSwap factories, but venues/pool-price.ts can only READ v3 pools
 * (slot0/observe/tick math). New memecoins overwhelmingly launch on v2, whose
 * pools price off getReserves() instead — so in a live sample of 30 discovered
 * pairs, ALL 30 came back "no route to USDG yet" and this strategy refused
 * every one of them. Until v2 pricing exists, trencher can only ever enter a
 * token that happens to have a v3 pool, which is a small minority of launches.
 *
 * Pricing v2 is NOT just "read the reserves": spot from reserves is exactly the
 * manipulable number pool-price.ts refuses to value positions with, and v2 has
 * no ready-made TWAP — its price*CumulativeLast accumulators need two samples
 * spaced over time, i.e. real cross-tick state. That is the work; doing it the
 * cheap way would quietly turn the drawdown breaker into decoration.
 */

import type { TradeIntent } from "../policy";
import type { Snapshot, Strategy } from "./types";

/** What the tick knows about a token it might enter. All chain-derived. */
export interface Candidate {
  symbol: string;
  token: `0x${string}`;
  decimals: number;
  /** Passed the depth + divergence guards this tick. */
  priceable: boolean;
  /** USD depth of the shallowest leg of its route. */
  liquidityUsd: number;
  /** Fully diluted value — supply × price. NOT float; see token-stats.ts. */
  fdvUsd: number;
  /** Seconds since the pool was initialized. */
  ageSec: number;
  price8: bigint;
}

/** What we remember about something already held, so exits can be judged. */
export interface OpenPosition {
  symbol: string;
  token: `0x${string}`;
  entryPrice8: bigint;
  /** Depth at the moment of entry — the baseline a drain is measured against. */
  entryLiquidityUsd: number;
  entrySec: number;
  costUsdg: bigint;
}

export interface TrencherConfig {
  /** Per-entry size, USDG (6dp). Bounded again by the scout budget upstream. */
  perEntryUsdg: bigint;
  /** Refuse anything thinner than this at entry. */
  minLiquidityUsd: number;
  /** FDV band. Below the floor there's nothing there; above the ceiling a new
   *  launch's "value" is usually supply games rather than money. */
  minFdvUsd: number;
  maxFdvUsd: number;
  /** Ignore the first minutes — the window where anything can happen and does. */
  minAgeSec: number;
  /** After this it isn't a new pair; if it's still interesting, add it properly. */
  maxAgeSec: number;
  /** Exit if price falls this far below entry, in bps. */
  stopLossBps: number;
  /** Exit if price rises this far above entry, in bps. */
  takeProfitBps: number;
  /** Exit if depth falls to this fraction of what it was at entry. */
  liquidityDrainFraction: number;
  /** Exit regardless after this long — a trench position isn't an investment. */
  maxHoldSec: number;
}

export const TRENCHER_DEFAULTS: TrencherConfig = {
  perEntryUsdg: 5_000_000n, // $5
  minLiquidityUsd: 25_000,
  minFdvUsd: 50_000,
  maxFdvUsd: 5_000_000,
  minAgeSec: 10 * 60,
  maxAgeSec: 24 * 3600,
  stopLossBps: 3_500, // -35%
  takeProfitBps: 10_000, // +100%
  liquidityDrainFraction: 0.5,
  maxHoldSec: 3 * 24 * 3600,
};

export type EntryVerdict = { enter: true } | { enter: false; why: string };

/**
 * Should this be entered? EVERY condition must hold.
 *
 * Each refusal names itself, because "no trade" with no reason is ind/
 * distinguishable from a broken feed, and the owner needs to be able to tell
 * "nothing qualified" from "nothing was checked".
 */
export function shouldEnter(c: Candidate, cfg: TrencherConfig, nowSec: number): EntryVerdict {
  // Don't blame the guards for this: `priceable` is false BOTH when the depth/
  // divergence guards rejected a pool AND when there is no readable pool at all
  // (venues/pool-price.ts reads PancakeSwap v3 only, and most new memecoins
  // launch on v2 — see this module's header). Claiming a risk judgment we
  // didn't make would read as "checked and refused" when it was "never priced".
  if (!c.priceable) {
    return { enter: false, why: "no trusted price — no v3 pool to read, or its depth/divergence guards refused it" };
  }
  if (c.liquidityUsd < cfg.minLiquidityUsd) {
    return { enter: false, why: `only $${Math.round(c.liquidityUsd).toLocaleString()} deep` };
  }
  if (c.fdvUsd < cfg.minFdvUsd) {
    return { enter: false, why: `FDV $${Math.round(c.fdvUsd).toLocaleString()} — nothing there yet` };
  }
  if (c.fdvUsd > cfg.maxFdvUsd) {
    return { enter: false, why: `FDV $${Math.round(c.fdvUsd).toLocaleString()} — priced past a new launch` };
  }
  if (c.ageSec < cfg.minAgeSec) {
    return { enter: false, why: `only ${Math.round(c.ageSec / 60)}m old — too early to read` };
  }
  if (c.ageSec > cfg.maxAgeSec) {
    return { enter: false, why: `${Math.round(c.ageSec / 3600)}h old — not a new pair any more` };
  }
  return { enter: true };
}

export type ExitVerdict = { exit: false } | { exit: true; why: string };

/**
 * Should this be closed? ANY condition is enough.
 *
 * Ordered by how badly it ends: an unpriceable or drained position is a position
 * that may not be exitable at all in an hour, so those are checked before the
 * ordinary stop.
 */
export function shouldExit(
  pos: OpenPosition,
  now: { price8: bigint | null; liquidityUsd: number | null; nowSec: number },
  cfg: TrencherConfig,
): ExitVerdict {
  // Can't price it any more. Whatever happened, the window to leave is closing.
  if (now.price8 === null || now.price8 <= 0n) {
    return { exit: true, why: "can't be priced any more — leaving while there's still a route" };
  }
  // Liquidity walking out is the shape a rug actually takes, and it precedes
  // the price move rather than following it.
  if (
    now.liquidityUsd !== null &&
    pos.entryLiquidityUsd > 0 &&
    now.liquidityUsd < pos.entryLiquidityUsd * cfg.liquidityDrainFraction
  ) {
    const pct = Math.round((1 - now.liquidityUsd / pos.entryLiquidityUsd) * 100);
    return { exit: true, why: `${pct}% of the liquidity has left since entry` };
  }
  const bps = priceMoveBps(pos.entryPrice8, now.price8);
  if (bps <= -cfg.stopLossBps) return { exit: true, why: `down ${Math.abs(bps / 100).toFixed(1)}% from entry` };
  if (bps >= cfg.takeProfitBps) return { exit: true, why: `up ${(bps / 100).toFixed(1)}% from entry` };
  if (now.nowSec - pos.entrySec > cfg.maxHoldSec) {
    return { exit: true, why: `held ${Math.round((now.nowSec - pos.entrySec) / 3600)}h — past the window` };
  }
  return { exit: false };
}

/** Signed move from entry to now, in bps. Negative = down. */
export function priceMoveBps(entry8: bigint, now8: bigint): number {
  if (entry8 <= 0n) return 0;
  return Number(((now8 - entry8) * 10_000n) / entry8);
}

export interface TrencherDeps {
  cfg: TrencherConfig;
  swapRouter: `0x${string}`;
  usdgToken: `0x${string}`;
  /** Candidates the discovery pass surfaced and the tick could price. */
  candidates: () => readonly Candidate[];
  /** What's currently held from previous entries. */
  open: () => readonly OpenPosition[];
  /** Live depth for a held token, when it's still readable. */
  liquidityOf: (token: `0x${string}`) => number | null;
  onNote?: (level: "ok" | "warn", message: string) => void;
}

/**
 * EXITS ARE EVALUATED FIRST, AND UNCONDITIONALLY.
 *
 * Not a style choice. Entries consume the daily budget and the ops cap, so an
 * entry-first pass can spend the very allowance a stop-loss needed a moment
 * later — the agent buys its way out of being able to sell. Getting out is
 * always more urgent than getting in.
 */
export function makeTrencher(deps: TrencherDeps): Strategy {
  return {
    name: "trencher",
    async tick(snap: Snapshot): Promise<TradeIntent[]> {
      const nowSec = Math.floor(Date.now() / 1000);
      const intents: TradeIntent[] = [];
      if (!snap.sequencerUp) return intents;

      // ── exits first, always ────────────────────────────────────────────
      const openNow = deps.open();
      for (const pos of openNow) {
        const held = snap.holdings.get(pos.symbol);
        if (!held || held.rawBalance <= 0n) continue;
        const quote = snap.prices.get(pos.symbol);
        const verdict = shouldExit(
          pos,
          {
            price8: quote?.price8 ?? null,
            liquidityUsd: deps.liquidityOf(pos.token),
            nowSec,
          },
          deps.cfg,
        );
        if (!verdict.exit) continue;
        deps.onNote?.("warn", `trencher: selling ${pos.symbol} — ${verdict.why}`);
        intents.push({
          kind: "swap",
          target: deps.swapRouter,
          sellToken: pos.token,
          buyToken: deps.usdgToken,
          sellAmountRaw: held.rawBalance, // the whole position; partials leave a tail
          notionalUsdg: held.valueUsdg,
        });
      }

      // ── entries, only with what's left ─────────────────────────────────
      const heldSymbols = new Set(openNow.map((p) => p.symbol));
      for (const c of deps.candidates()) {
        if (heldSymbols.has(c.symbol)) continue;
        if (snap.pausedTokens.has(c.token.toLowerCase())) continue;
        const size = deps.cfg.perEntryUsdg;
        // Respect the daily headroom as a sizing hint, exactly as other
        // strategies do — the wall still refuses anything over, this just stops
        // the same oversized intent being re-proposed every tick forever.
        if (size > snap.spendHeadroomUsdg || size > snap.perTradeCapUsdg) continue;
        const verdict = shouldEnter(c, deps.cfg, nowSec);
        if (!verdict.enter) {
          deps.onNote?.("ok", `trencher: passing on ${c.symbol} — ${verdict.why}`);
          continue;
        }
        deps.onNote?.(
          "ok",
          `trencher: entering ${c.symbol} — $${Math.round(c.liquidityUsd).toLocaleString()} deep, ` +
            `FDV $${Math.round(c.fdvUsd).toLocaleString()}, ${Math.round(c.ageSec / 60)}m old`,
        );
        intents.push({
          kind: "swap",
          target: deps.swapRouter,
          sellToken: deps.usdgToken,
          buyToken: c.token,
          sellAmountRaw: size,
          notionalUsdg: size,
        });
        // One entry per tick. A discovery burst shouldn't become a burst of
        // simultaneous positions in tokens that all launched from the same
        // deployer minutes apart.
        break;
      }

      return intents;
    },
  };
}
