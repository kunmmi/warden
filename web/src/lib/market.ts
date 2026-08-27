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
 * PRICE is now wired to the same PancakeSwap v3 TWAP reader the worker's own
 * tick loop uses (worker/src/venues/pool-prices.ts) — same cache, same
 * liquidity-floor/divergence guard, same refuse-rather-than-fabricate
 * philosophy, just pointed at this table instead of a trade decision. volume/
 * holders/logo stay explicitly null: there's still no BSC data source for
 * them, and MarketTable.tsx already renders those as "—" honestly.
 *
 * Always reads BSC MAINNET, regardless of which chain the viewer's own grant
 * is on — these are real-world token prices, not account-scoped data, and the
 * underlying pools only have real liquidity on mainnet (testnet has none, see
 * wall.ts's own note that the wall is "inert on testnet").
 *
 * The reader is a module-level singleton so its cache (15-minute TWAP window,
 * ~60s TTL) actually helps across requests — this only works because the app
 * runs as one long-lived `next start` process, not a serverless function per
 * request.
 */

import { readFile } from "node:fs/promises";
import { createPublicClient, http } from "viem";
import { STOCK_TOKENS, bscChain, type WardenSettings } from "@warden/core";
import { homePaths } from "@/lib/home";
import { createPoolPriceReader } from "../../../worker/src/venues/pool-prices";

const MIN_POOL_LIQUIDITY_USDG_DEFAULT = 25_000;
const MAX_PRICE_DIVERGENCE_BPS_DEFAULT = 500;

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
  volume24hUsd: number | null;
  holders: number | null;
  /** Why this token has no price right now — set only when refused, never fabricated. */
  refusedReason: string | null;
}

export interface MarketData {
  fetchedAt: number;
  tokens: MarketToken[];
}

async function readSettings(): Promise<WardenSettings> {
  try {
    return JSON.parse((await readFile(homePaths.settings(), "utf8")).replace(/^﻿/, "")) as WardenSettings;
  } catch {
    return {};
  }
}

const poolPrices = createPoolPriceReader();
const publicClient = createPublicClient({ chain: bscChain, transport: http() });

export async function fetchMarket(): Promise<MarketData> {
  const nowSec = Math.floor(Date.now() / 1000);
  const settings = await readSettings();

  const { quotes, refused } = await poolPrices.read({
    client: publicClient,
    tokens: STOCK_TOKENS,
    guard: {
      minLiquidityUsdg: BigInt(Math.round((settings.minPoolLiquidityUsdg ?? MIN_POOL_LIQUIDITY_USDG_DEFAULT) * 1e6)),
      maxDivergenceBps: settings.maxPriceDivergenceBps ?? MAX_PRICE_DIVERGENCE_BPS_DEFAULT,
    },
    nowSec,
  });
  const refusedBySymbol = new Map(refused.map((r) => [r.symbol, r.reason]));

  const tokens: MarketToken[] = STOCK_TOKENS.map((t) => {
    const quote = quotes.get(t.symbol);
    return {
      symbol: t.symbol,
      name: t.name,
      kind: t.kind,
      address: t.address,
      logo: null,
      priceUsd: quote ? Number(quote.price8) / 1e8 : null,
      // A TWAP is time-averaged by construction, not stale in the Chainlink
      // sense — see pool-prices.ts's own note. Stamping "now" on every fresh
      // quote is what makes MarketTable.tsx correctly show "live" instead of
      // misreading pool prices through Chainlink's staleness rules.
      priceUpdatedAt: quote ? nowSec : null,
      paused: false,
      uiMultiplier: null,
      volume24hUsd: null,
      holders: null,
      refusedReason: quote ? null : (refusedBySymbol.get(t.symbol) ?? null),
    };
  });

  return { fetchedAt: nowSec, tokens };
}
