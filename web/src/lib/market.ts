/**
 * Market data layer — server-side only.
 *
 * merrymen's original sourced this from Robinhood-Chain-specific infra with no
 * BSC equivalent: Chainlink feeds on issuer-backed Stock Tokens (v0's BSC
 * registry has none — see tokens.ts, every entry is `kind: "memecoin"` with
 * `chainlinkFeed: null`), the Stock Token contract's tokenPaused/uiMultiplier
 * (a Robinhood-Chain-only ERC-8056 mechanism, meaningless on a plain BEP-20),
 * Robinhood's Blockscout instance and CDN (wrong host for BSC), and Rialto (a
 * Robinhood-proprietary venue, no BSC equivalent — see protocols.ts).
 *
 * Rather than point any of that at BSC hosts that don't exist or don't apply,
 * this returns the registry with price/volume/holders explicitly null and
 * paused/rialtoLiquid false. worker/src/venues/pancakeswap-v3.ts already has
 * live BSC pricing (PancakeSwap v3 TWAP) for the paper-trading path; wiring a
 * price into this web-facing market table too is real, separate work — v1/v2
 * scope, not a reference swap. MarketTable.tsx already renders all of these
 * fields as "—"/"no feed" when null/false, so this degrades honestly instead
 * of either crashing or showing fabricated numbers.
 */

import { STOCK_TOKENS } from "@warden/core";

export interface MarketToken {
  symbol: string;
  name: string;
  kind: "stock" | "etf" | "memecoin";
  address: string;
  logo: string | null;
  priceUsd: number | null;
  /** Unix seconds of the last Chainlink update; null when the token has no feed. */
  priceUpdatedAt: number | null;
  paused: boolean;
  /** 1.0 = no pending corporate action. */
  uiMultiplier: number | null;
  rialtoLiquid: boolean;
  volume24hUsd: number | null;
  holders: number | null;
}

export interface MarketData {
  fetchedAt: number;
  tokens: MarketToken[];
}

export async function fetchMarket(): Promise<MarketData> {
  const tokens: MarketToken[] = STOCK_TOKENS.map((t) => ({
    symbol: t.symbol,
    name: t.name,
    kind: t.kind,
    address: t.address,
    logo: null,
    priceUsd: null,
    priceUpdatedAt: null,
    paused: false,
    uiMultiplier: null,
    rialtoLiquid: false,
    volume24hUsd: null,
    holders: null,
  }));

  return { fetchedAt: Math.floor(Date.now() / 1000), tokens };
}
