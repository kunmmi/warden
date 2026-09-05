/**
 * Discovery — telling the owner a pair exists, and nothing more than that.
 *
 * On BSC, new pairs are visible on-chain by construction: PancakeSwap's V2 and
 * V3 factories emit a plain `PairCreated`/`PoolCreated` event, so
 * venues/pancake-discovery.ts reads them straight off public RPC — no account,
 * no key. (This replaced an earlier Bitquery-backed version built for the
 * original chain, where launches went through hooked pools with no
 * discoverable address of their own; that problem doesn't exist here.)
 *
 * WHAT THIS IS EXPLICITLY NOT. It does not add tokens, widen a cap, or produce a
 * trade. This module only ever REPORTS and records what it found.
 *
 * The `trencher` strategy can act on those records — but only when the owner has
 * selected it, and in live mode only for a token they added and re-signed the
 * grant to cover. So the sequence stays owner → wall → agent, never feed →
 * agent. Nothing here is on the dispose side, and it must stay that way: a
 * discovery feed that could open positions BY ITSELF would be a feed that
 * decides what to buy, which is the one thing the permission model exists to
 * prevent. Recording a candidate is not deciding to hold it.
 *
 * It also runs on its OWN slow cadence, not the trading tick — a public RPC
 * still has rate limits, and a poll that starved the trading loop of its
 * allowance would trade one feature for another the owner is more likely to
 * be relying on.
 */

import type { PublicClient } from "viem";
import { parseAbi } from "viem";
import { CASH, USDT_DECIMALS, type StockToken } from "../../packages/core/src/index";
import { poolPriceUsable, readRoutedPrice } from "./venues/pool-price";
import { readTokenStats } from "./venues/token-stats";
import { recentPools, type NewPair } from "./venues/pancake-discovery";

const ERC20 = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

/** A pair worth telling the owner about, with enough context to judge it. */
export interface Discovery {
  token: `0x${string}`;
  symbol: string;
  decimals: number;
  /** Unix seconds the pool was initialized. */
  createdAt: number;
  /** USD depth of the shallowest leg, when it could be priced at all. */
  liquidityUsdg: bigint | null;
  /** Would this clear the owner's own depth/divergence guards today? */
  priceable: boolean;
  /** When it wouldn't, the guard's own words. */
  reason?: string;
  /** Guarded price, 8dp — null when it couldn't be priced. */
  price8: bigint | null;
  /**
   * Fully diluted value, supply × price. Null when unpriceable or unreadable.
   * FDV, not market cap — see token-stats.ts for why the distinction matters
   * when the number is about to gate spending.
   */
  fdvUsd: number | null;
}

/**
 * Cash-side tokens. A new pool always pairs the new token against one of these,
 * so whichever side is NOT in here is the thing that launched.
 */
const CASH_SIDE = new Set<string>([
  (CASH.USDT as string).toLowerCase(),
  (CASH.WBNB as string).toLowerCase(),
  "0x0000000000000000000000000000000000000000",
]);

/** Which side of the pair is the new token? null when neither side is cash. */
export function newTokenOf(pair: NewPair): `0x${string}` | null {
  const a = pair.token.toLowerCase();
  const b = pair.quote.toLowerCase();
  const aCash = CASH_SIDE.has(a);
  const bCash = CASH_SIDE.has(b);
  // Both cash (a USDG/WETH pool) or neither (an exotic pair we can't value
  // against anything we hold) are equally not-a-launch. Say nothing.
  if (aCash === bCash) return null;
  return (aCash ? b : a) as `0x${string}`;
}

export interface DiscoveryDeps {
  /** For token identity + pricing reads — the same client the rest of the worker trusts. */
  client: PublicClient;
  /**
   * For the `eth_getLogs` scan specifically. Kept separate on purpose: the
   * trading path's own RPC (bsc-dataseed.binance.org) refuses getLogs outright
   * — see pancake-discovery.ts's module doc. Build one with createDiscoveryClient().
   */
  logsClient: PublicClient;
  guard: { minLiquidityUsdg: bigint; maxDivergenceBps: number };
  /** Addresses already reported — the caller persists these across restarts. */
  seen: ReadonlySet<string>;
  /** Tokens already configured; no point announcing what the owner has. */
  known: readonly StockToken[];
  sinceMinutes?: number;
}

/**
 * One discovery pass. Returns only genuinely new, genuinely relevant pairs.
 *
 * Every failure degrades to an empty list rather than throwing: this runs beside
 * a trading loop, and a data provider having a bad minute must never be able to
 * interrupt an agent that might need to sell.
 */
export async function discoverPools(deps: DiscoveryDeps): Promise<Discovery[]> {
  const data = await recentPools(deps.logsClient, { sinceMinutes: deps.sinceMinutes ?? 60, limit: 25 });
  if (!data.length) return [];

  const knownAddrs = new Set(deps.known.map((t) => t.address.toLowerCase()));
  const candidates: `0x${string}`[] = [];
  const seenThisPass = new Set<string>();
  for (const pair of data) {
    const token = newTokenOf(pair);
    if (!token) continue;
    const key = token.toLowerCase();
    if (deps.seen.has(key) || knownAddrs.has(key) || seenThisPass.has(key)) continue;
    seenThisPass.add(key);
    candidates.push(token);
  }
  if (!candidates.length) return [];

  const out: Discovery[] = [];
  for (const token of candidates) {
    // Read identity from the CONTRACT, never from the indexer. A symbol is
    // attacker-chosen text that will be shown to a human and could be picked to
    // impersonate a real ticker; taking it from the chain at least means it's
    // the token's own claim, and the length/charset cap below bounds the damage.
    let symbol = `${token.slice(0, 10)}…`;
    let decimals = 18;
    try {
      const [s, d] = await Promise.all([
        deps.client.readContract({ address: token, abi: ERC20, functionName: "symbol" }) as Promise<string>,
        deps.client.readContract({ address: token, abi: ERC20, functionName: "decimals" }) as Promise<number>,
      ]);
      if (typeof s === "string" && s.length > 0) symbol = sanitizeSymbol(s);
      const dn = Number(d);
      if (Number.isInteger(dn) && dn >= 0 && dn <= 36) decimals = dn;
    } catch {
      // Not a readable ERC-20. Still worth reporting — it launched — but with
      // the address as its name rather than something we couldn't verify.
    }

    let liquidityUsdg: bigint | null = null;
    let priceable = false;
    let reason: string | undefined;
    let price8: bigint | null = null;
    let fdvUsd: number | null = null;
    try {
      const routed = await readRoutedPrice(deps.client, {
        token,
        tokenDecimals: decimals,
        cash: CASH.USDT as `0x${string}`,
        cashDecimals: USDT_DECIMALS,
        weth: CASH.WBNB as `0x${string}`,
      });
      if (!routed) {
        reason = "no route to USDG yet";
      } else {
        liquidityUsdg = routed.liquidityUsdg;
        const verdict = poolPriceUsable(routed, deps.guard);
        priceable = verdict.ok;
        if (!verdict.ok) reason = verdict.reason;
        // FDV only from a price that PASSED the guards. Deriving it from an
        // unguarded reading would produce a valuation anyone could move — and
        // this figure gates whether money gets spent.
        if (verdict.ok) {
          price8 = routed.price8;
          const stats = await readTokenStats(deps.client, { token, price8: routed.price8, decimals });
          fdvUsd = stats?.fdvExBurnedUsd ?? null;
        }
      }
    } catch {
      reason = "couldn't read its pool";
    }

    out.push({ token, symbol, decimals, createdAt: 0, liquidityUsdg, priceable, reason, price8, fdvUsd });
  }
  return out;
}

/**
 * A token's own symbol is attacker-chosen and ends up in a Telegram message and
 * an event line. Strip anything that could pass for markup or a separator, and
 * cap the length — the same reasoning as the memory sanitizers.
 */
export function sanitizeSymbol(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 16);
  return cleaned.length > 0 ? cleaned : "?";
}

/** The owner-facing line. Says what it is, and what it would still take to trade it. */
export function describeDiscovery(d: Discovery): string {
  const depth =
    d.liquidityUsdg === null
      ? "depth unknown"
      : `$${(Number(d.liquidityUsdg) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })} deep`;
  const fdv = d.fdvUsd === null ? "" : ` · FDV ${Math.round(d.fdvUsd).toLocaleString()}`;
  const verdict = d.priceable
    ? "deep enough for me to price"
    : `I can't price it yet — ${d.reason ?? "guards refused it"}`;
  return `🌱 new pair: ${d.symbol} (${d.token.slice(0, 10)}…) · ${depth}${fdv} · ${verdict}`;
}
