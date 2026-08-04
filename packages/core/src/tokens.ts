/**
 * Token registry — BNB Smart Chain mainnet (56).
 *
 * v0 is a small, curated list of liquid BEP-20 tokens rather than the broad
 * issuer-backed Stock Token registry merrymen had on Robinhood Chain — there is
 * no BSC equivalent of tokenized equities, so this list is deliberately narrow:
 * the wrapped native asset, the DEX's own governance token, and the two most
 * liquid bridged majors. All four addresses were cross-checked against BscScan's
 * verified token pages (2026-08).
 *
 * None of these carry a Chainlink feed in v0 — see worker/src/venues/pool-price.ts
 * for why a guarded PancakeSwap v3 TWAP is the valuation source instead (deep
 * pools exist for all four, so the liquidity-floor/divergence guards are
 * meaningful rather than decorative). `kind: "memecoin"` here just means "no
 * feed, no ERC-8056 multiplier, priced from a DEX pool" — the label is inherited
 * from the Robinhood-Chain type union, not a claim about the asset's quality.
 */

export interface StockToken {
  symbol: string;
  name: string;
  address: `0x${string}`;
  /** Chainlink AggregatorV3 feed (USD). null = no feed published yet. */
  chainlinkFeed: `0x${string}` | null;
  /**
   * "stock"/"etf" are issuer-backed Stock Tokens with Chainlink feeds and
   * ERC-8056 multipliers — unused in v0 (no BSC equivalent). "memecoin" is any
   * other ERC-20 on the chain: no feed, no multiplier, priced from a DEX pool
   * and only when the pool is deep enough to be worth trusting (see
   * worker/src/venues/pool-price.ts).
   */
  kind: "stock" | "etf" | "memecoin";
  /** ERC-20 decimals. All four v0 tokens and WBNB are 18. */
  decimals?: number;
  /**
   * How this token reaches USD. Undefined means "try direct [token]/USDT first,
   * then fall back to [token]/WBNB × WBNB/USDT" — the routing default in
   * worker/src/venues/pool-price.ts.
   */
  quote?: "usdt" | "wbnb";
}

/**
 * User-added tokens live in settings, not here — this file is the curated,
 * issuer-backed registry and stays that way. A memecoin the owner adds is
 * their choice and their risk, so it is stored with their config and must pass
 * the same liquidity/divergence guards as anything else before it is valued.
 */
export interface CustomToken {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
}

/**
 * A price AND where it came from.
 *
 * Chainlink, a Uniswap pool, and a brokerage quote are not the same evidential
 * quality: the first is an external feed that costs real money to move, the
 * second is a pool balance, the third is the venue's own last-trade print. All
 * three end up as an 8dp number, and once they're just numbers nothing
 * downstream can tell them apart — so the provenance travels with the price.
 *
 * `source` is REQUIRED, never optional with a default. A field someone forgot to
 * set must not silently read as "trustworthy". It is also load-bearing for
 * VALUATION, not just display: chainlink quotes USD per ERC-8056 UI share (the
 * multiplier applies), while pool and broker quote the market's own unit, which
 * already reflects any split (the multiplier must NOT apply) — see
 * worker/src/positions.ts, valuationMultiplierFor.
 */
export interface PriceQuote {
  /** USD per whole token, 8dp — the same unit Chainlink feeds emit. */
  price8: bigint;
  /** Chainlink feed older than 2h. Expected on weekends (feeds run 24/5). */
  stale: boolean;
  /** "broker" = Robinhood get_equity_quotes on the Agentic-account rail. */
  source: "chainlink" | "pool" | "broker";
  /** For pool prices: route + depth, so a human can judge the number. */
  detail?: string;
}

/** Reject anything that isn't a plausible ERC-20 entry before it can reach a
 * policy allowlist or a price lookup. Shape only — depth is checked on-chain. */
export function isValidCustomToken(t: unknown): t is CustomToken {
  if (!t || typeof t !== "object") return false;
  const c = t as Partial<CustomToken>;
  if (typeof c.symbol !== "string" || !/^[A-Za-z0-9._-]{1,16}$/.test(c.symbol)) return false;
  if (typeof c.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(c.address)) return false;
  if (typeof c.decimals !== "number" || !Number.isInteger(c.decimals) || c.decimals < 0 || c.decimals > 36) {
    return false;
  }
  return true;
}

/**
 * Cash + gas legs on BSC.
 *
 * USDT: Binance-Peg BSC-USD, the de facto USDT on BNB Smart Chain — confirmed
 * 18 decimals on BscScan (2026-08). This is the one number in this file that
 * differs from every other chain's USDT (Ethereum/most L2s use 6): every
 * dollar-math call site that assumed a 6dp cash leg from the Robinhood-Chain
 * USDG days must be re-checked against this before trusting a displayed
 * number — see the TODOs left in worker/src/venues/pool-price.ts callers.
 *
 * WBNB: wrapped native BNB, the routing/gas leg most PancakeSwap pools quote
 * against (the BSC equivalent of WETH on Ethereum-family chains). 18 decimals.
 */
export const CASH = {
  /** Binance-Peg BSC-USD (USDT). 18 decimals — NOT 6, unlike Ethereum USDT. */
  USDT: "0x55d398326f99059fF775485246999027B3197955",
  WBNB: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
} as const;

export const USDT_DECIMALS = 18;

/**
 * v0 curated token list — no BSC equivalent of Robinhood's issuer-backed Stock
 * Tokens exists, so this is a small set of liquid, well-known BEP-20 tokens
 * instead of a broad registry. Addresses cross-checked against BscScan's
 * verified token pages (2026-08); no Chainlink feed wired in v0 (see the
 * StockToken.kind doc above — priced via guarded PancakeSwap v3 TWAP instead).
 */
export const STOCK_TOKENS: StockToken[] = [
  { symbol: "WBNB", name: "Wrapped BNB", address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", chainlinkFeed: null, kind: "memecoin", decimals: 18 },
  { symbol: "CAKE", name: "PancakeSwap Token", address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", chainlinkFeed: null, kind: "memecoin", decimals: 18 },
  { symbol: "BTCB", name: "Bitcoin BEP2", address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", chainlinkFeed: null, kind: "memecoin", decimals: 18 },
  { symbol: "ETH", name: "Binance-Peg Ethereum Token", address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", chainlinkFeed: null, kind: "memecoin", decimals: 18 },
];

/**
 * Stock tokens the grant's call policy may approve for a SELL. Every entry was
 * verified via QuoterV2 across the 500/3000/10000 fee tiers on **2026-07-27**,
 * in BOTH directions — a buy that quotes and a sell that doesn't is a trap, not
 * a feature.
 *
 * THIS LIST GOES STALE, AND THAT USED TO COST PEOPLE MONEY. It last read
 * QQQ/NVDA/TSLA (checked 2026-07-16); eleven days later AAPL, AMZN, GOOGL,
 * MSFT, MU, SPCX, USAR, SGOV, SLV, SPY and USO all had live pools. Meanwhile
 * /settings offered every registry symbol as a basket option and approving USDG
 * is generic, so an owner could pick AAPL, watch the agent buy it, and never be
 * able to sell — the exit reverted at the wall, silently, until they tried.
 *
 * Widening the list fixes today. What stops it recurring is the runtime rule in
 * worker/src/policy.ts: a BUY is refused unless the signed key can sell that
 * token back. Never enter a position you cannot exit — so the next pool seeded
 * on this chain is a missed opportunity, never a trapped position.
 *
 * Re-verify with `npx tsx scripts/probe-tradability.mts` and extend as pools
 * appear. Tokens still absent (BABA, BE, COIN, CRCL, CRWV, INTC, META, ORCL,
 * PLTR, SNDK) have no v3 pool at all, so they no-route on both sides — visibly
 * skipped, never held.
 */
export const TRADEABLE_SYMBOLS = [
  "AAPL", "AMZN", "GOOGL", "MSFT", "MU", "NVDA", "SPCX", "TSLA", "USAR",
  "QQQ", "SGOV", "SLV", "SPY", "USO",
] as const;

/**
 * What grants issued BEFORE 2026-07-27 baked into their call policy.
 *
 * The tradable set is sealed into a signed session key, so widening the list
 * above does nothing for a key that was already signed — and assuming otherwise
 * is precisely the trap this release fixes. A grant declares which set it
 * carries via the "tradeable-v2" entry in grantFeatures; without it, this is the
 * set, and the worker says so instead of letting a sell revert at the wall.
 */
export const LEGACY_TRADEABLE_SYMBOLS = ["QQQ", "NVDA", "TSLA"] as const;

/**
 * What a FRESH agent buys out of the box — deliberately not the whole tradable
 * set. These are two different questions and coupling them was a shortcut: the
 * allowlist should cover everything with an exit, while the default basket stays
 * a handful of the deepest names rather than spreading a first deposit across
 * fourteen legs. Owners widen it themselves in /settings.
 */
export const DEFAULT_BASKET_SYMBOLS = ["QQQ", "NVDA", "TSLA"] as const;

/** Minimal Stock ABI — the surface merrymen reads. Extracted from verified source 2026-07-09. */
export const STOCK_ABI = [
  // Standard ERC-20 reads
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  // ERC-8056 Scaled UI Amount
  { type: "function", name: "uiMultiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "newUIMultiplier", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "effectiveAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOfUI", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalSupplyUI", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  // Pause state — agents must check before trading
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "tokenPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "oraclePaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  // Events
  { type: "event", name: "Transfer", inputs: [{ name: "from", type: "address", indexed: true }, { name: "to", type: "address", indexed: true }, { name: "value", type: "uint256", indexed: false }] },
  { type: "event", name: "UIMultiplierUpdated", inputs: [{ name: "oldMultiplier", type: "uint256", indexed: false }, { name: "newMultiplier", type: "uint256", indexed: false }, { name: "effectiveAtTimestamp", type: "uint256", indexed: false }] },
] as const;
