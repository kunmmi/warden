/**
 * Pool pricing for the tick: batch, cache, and — most importantly — REFUSE.
 *
 * pool-price.ts knows how to read one token's TWAP from Uniswap. This module is
 * what the tick actually calls, and it adds the three things a trading loop
 * needs that a single read doesn't:
 *
 *  1. A GUARD APPLIED EVERY TIME. Reads are cached; verdicts are not. The owner
 *     can tighten the liquidity floor mid-run and the very next tick honours it,
 *     because the cache holds the raw route and the judgement is re-made fresh.
 *
 *  2. A CACHE, because a routed price is expensive. Each token costs up to three
 *     getPool + three balanceOf + token0 + slot0 + observe PER LEG, and most of
 *     this chain's memecoins are two legs. At 50 tokens on a 15s tick that is
 *     thousands of RPC calls a minute for a number whose whole point is that it
 *     moves slowly — the TWAP window is 15 minutes.
 *
 *  3. A REASON when there's no price. "CATE isn't priced" is not actionable;
 *     "CATE's pool holds $312, below your $5,000 floor" tells the owner whether
 *     to lower the floor, or that the coin is simply too thin to trade.
 *
 * A refusal is the correct outcome, not a failure. A price nobody can trust is
 * worse than no price at all: it feeds equity, P&L and the drawdown breaker, so
 * a manipulable number lets an outsider fake the owner's net worth or trip their
 * circuit breaker on demand.
 */

import type { PublicClient } from "viem";
import { CASH, USDT_DECIMALS, type PriceQuote, type StockToken } from "../../../packages/core/src/index";
import {
  poolPriceUsable,
  readRoutedPrice,
  type PriceGuard,
  type RefusalKind,
  type RoutedPrice,
} from "./pool-price";

/**
 * How long a routed read stays fresh. Well under the 15-minute TWAP window, so
 * the cached number is never a materially different number from a fresh one —
 * this trades RPC volume for staleness that the averaging window already implies.
 */
export const DEFAULT_CACHE_TTL_SEC = 60;

/**
 * How long a route may go UNCONFIRMED before it stops counting.
 *
 * readRoutedPrice returns null for two different things — "there is no pool" and
 * "the RPC didn't answer" — and the caller can't tell them apart. Letting null
 * always win means one flaky call drops a held position's valuation, which pauses
 * equity, the high-water mark and the drawdown breaker for that tick. Letting the
 * old route always win means a pool that was genuinely drained keeps producing a
 * price forever.
 *
 * So: a route that fails to refresh is KEPT but does not have its age reset, and
 * it is dropped once it passes this bound. Comfortably inside the 15-minute TWAP
 * window, so a route served at the limit is still a number of the same kind.
 */
export const MAX_ROUTE_AGE_SEC = 600;

export interface PoolQuoteRefusal {
  symbol: string;
  /**
   * A stable identifier for WHY. Callers that only want to speak up when the
   * situation changes must key on this, never on `reason` — the prose carries a
   * live pool balance and a divergence percentage, so it changes every time
   * anyone trades, and a change-detector built on it fires forever.
   */
  kind: RefusalKind | "no-pool" | "stale-read";
  reason: string;
}

export interface PoolPricesResult {
  /** Symbol → quote, for tokens whose price passed the guard. */
  quotes: Map<string, PriceQuote>;
  /** Tokens deliberately left unpriced, each with a reason a human can act on. */
  refused: PoolQuoteRefusal[];
}

interface CacheEntry {
  /** The raw route, unjudged. null = no pool found at all. */
  routed: RoutedPrice | null;
  fetchedAt: number;
}

export interface PoolPriceReader {
  read(args: {
    client: PublicClient;
    tokens: readonly StockToken[];
    guard: PriceGuard;
    /** Unix seconds. Passed in rather than read from the clock so tests are honest. */
    nowSec: number;
  }): Promise<PoolPricesResult>;
  /** Drop everything cached — used when the chain or RPC changes underfoot. */
  reset(): void;
}

/** Human-readable provenance. Shown wherever a pool-priced value is displayed. */
export function describeRoute(r: RoutedPrice): string {
  const depth = Number(r.liquidityUsdg) / 1e6;
  const hop = r.route === "direct" ? "USDG pool" : "via WETH";
  return `${r.twapWindowSec / 60}m TWAP, ${hop}, $${depth.toLocaleString(undefined, { maximumFractionDigits: 0 })} deep`;
}

/**
 * The cache key includes DECIMALS, not just the address.
 *
 * A cached price8 was computed with the decimals declared at fetch time, and
 * positionValueUsdg divides by 10^decimals from the CURRENT settings. Key on the
 * address alone and correcting a mis-declared token (18 → 9, say) serves the old
 * price against the new divisor for a full TTL — valuing the holding 10^9 times
 * high, ratcheting that into the PERSISTED high-water mark, and tripping the
 * drawdown breaker permanently once the cache catches up.
 */
const cacheKey = (t: StockToken) => `${t.address.toLowerCase()}:${t.decimals ?? 18}`;

export function createPoolPriceReader(opts?: { ttlSec?: number }): PoolPriceReader {
  const ttlSec = opts?.ttlSec ?? DEFAULT_CACHE_TTL_SEC;
  const cache = new Map<string, CacheEntry>();

  return {
    reset() {
      cache.clear();
    },

    async read({ client, tokens, guard, nowSec }) {
      const quotes = new Map<string, PriceQuote>();
      const refused: PoolQuoteRefusal[] = [];
      if (!tokens.length) return { quotes, refused };

      // Only the misses go to the network. A warm cache costs nothing.
      const stale = tokens.filter((t) => {
        const hit = cache.get(cacheKey(t));
        return !hit || nowSec - hit.fetchedAt >= ttlSec;
      });

      await Promise.all(
        stale.map(async (t) => {
          const key = cacheKey(t);
          const previous = cache.get(key);
          let routed: RoutedPrice | null = null;
          try {
            routed = await readRoutedPrice(client, {
              token: t.address,
              tokenDecimals: t.decimals ?? 18,
              cash: CASH.USDT as `0x${string}`,
              cashDecimals: 6,
              weth: CASH.WBNB as `0x${string}`,
            });
          } catch {
            routed = null; // readRoutedPrice usually swallows its own errors anyway
          }
          if (routed) {
            cache.set(key, { routed, fetchedAt: nowSec });
            return;
          }
          // Nothing came back. That's either "no pool" or "the RPC didn't
          // answer" — indistinguishable here. Keep a route we already had, but
          // do NOT touch fetchedAt: it keeps ageing, and MAX_ROUTE_AGE_SEC below
          // eventually retires it whichever of the two it actually was.
          if (!previous?.routed) cache.set(key, { routed: null, fetchedAt: nowSec });
        }),
      );

      for (const t of tokens) {
        const hit = cache.get(cacheKey(t));
        if (hit?.routed && nowSec - hit.fetchedAt > MAX_ROUTE_AGE_SEC) {
          refused.push({
            symbol: t.symbol,
            kind: "stale-read",
            reason: `pool hasn't been readable for ${Math.round((nowSec - hit.fetchedAt) / 60)}m — refusing to keep valuing it off a stale reading`,
          });
          continue;
        }
        if (!hit || !hit.routed) {
          refused.push({
            symbol: t.symbol,
            kind: "no-pool",
            reason: "no Uniswap v3 pool against USDG or WETH — nothing to price it from",
          });
          continue;
        }
        const r = hit.routed;
        // The guard is re-applied on every read, against the CURRENT settings —
        // a cached route must never carry a stale verdict.
        const verdict = poolPriceUsable(r, guard);
        if (!verdict.ok) {
          refused.push({ symbol: t.symbol, kind: verdict.kind, reason: verdict.reason });
          continue;
        }
        quotes.set(t.symbol, {
          price8: r.price8,
          // A TWAP is time-averaged by construction, not stale in the Chainlink
          // sense (a feed that stopped updating). Flagging it stale would make
          // every memecoin look broken on a weekend for no reason.
          stale: false,
          source: "pool",
          detail: describeRoute(r),
        });
      }

      return { quotes, refused };
    },
  };
}
