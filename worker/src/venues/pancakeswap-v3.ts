/**
 * PancakeSwap v3 — read-only quoting venue for BSC.
 *
 * Modeled directly on uniswap.ts (Uniswap v3's QuoterV2 pattern): PancakeSwap
 * v3 is a Uniswap v3 fork, so the ABI shapes are near-identical. This is the
 * v0 quoting venue for Warden — see the build plan for why v0 is quote-only
 * (real BSC mainnet prices, simulated paper fills, no wallet/execution yet).
 *
 * Addresses (worker/../packages/core/src/protocols.ts PANCAKESWAP) were
 * cross-checked against BscScan's verified-contract pages and PancakeSwap's
 * developer docs (2026-08):
 *   - Factory:   0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865
 *   - QuoterV2:  0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997
 *
 * FEE TIERS DIFFER FROM UNISWAP. PancakeSwap v3 uses 100/500/2500/10000
 * (Uniswap v3 uses 500/3000/10000) — scanning Uniswap's tiers against a
 * PancakeSwap pool would silently miss the 100bps and 2500bps tiers and could
 * pick the wrong (non-existent) pool entirely.
 *
 * NO v4/hook logic here — PancakeSwap's newer "Infinity" AMM (v4-style hooks)
 * is out of scope for v0; only the plain v3 QuoterV2 path is ported. No
 * execution helpers either (no buildTradeCalls/buildSwapCall) — v0 is
 * read-only, execution is v1 work once the on-chain wall is ported.
 */

import { parseAbi, type Hex, type PublicClient } from "viem";
import { PANCAKESWAP } from "../../../packages/core/src/index";

/** PancakeSwap v3 fee tiers, most-likely-liquid first. Different from Uniswap v3. */
export const FEE_TIERS = [500, 2500, 100, 10000] as const;

export const QUOTER_V2_ABI = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)",
]);

export interface Quote {
  fee: number;
  amountOut: bigint;
  gasEstimate: bigint;
  /** The hops, in order, when this quote is multi-hop. Absent = single-hop. */
  path?: { tokens: readonly `0x${string}`[]; fees: readonly number[] };
}

/**
 * Pack a PancakeSwap/Uniswap v3-style path: token(20) fee(3) token(20) [fee(3) token(20)]…
 * Identical packing to Uniswap v3 — only the fee tiers scanned differ.
 */
export function encodePath(
  tokens: readonly `0x${string}`[],
  fees: readonly number[],
): Hex {
  if (tokens.length < 2 || fees.length !== tokens.length - 1) {
    throw new Error(`bad path: ${tokens.length} tokens, ${fees.length} fees`);
  }
  let out = "0x";
  tokens.forEach((t, i) => {
    out += t.slice(2).toLowerCase();
    if (i < fees.length) out += fees[i]!.toString(16).padStart(6, "0");
  });
  return out as Hex;
}

/** Highest amountOut wins; null when no tier has a pool with liquidity. */
export function pickBestQuote(quotes: readonly (Quote | null)[]): Quote | null {
  let best: Quote | null = null;
  for (const q of quotes) {
    if (q && q.amountOut > 0n && (!best || q.amountOut > best.amountOut)) best = q;
  }
  return best;
}

/** minOut = quoted × (10000 − slippageBps) / 10000, floor semantics. */
export function minOutWithSlippage(amountOut: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps >= 10_000) {
    throw new Error(`slippageBps out of range: ${slippageBps}`);
  }
  return (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** Quote one tier via eth_call simulation; null = no pool / no liquidity there. */
export async function quoteTier(
  client: PublicClient,
  args: { tokenIn: `0x${string}`; tokenOut: `0x${string}`; amountIn: bigint; fee: number },
): Promise<Quote | null> {
  try {
    const { result } = await client.simulateContract({
      address: PANCAKESWAP.v3QuoterV2 as `0x${string}`,
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInputSingle",
      args: [
        {
          tokenIn: args.tokenIn,
          tokenOut: args.tokenOut,
          amountIn: args.amountIn,
          fee: args.fee,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });
    const [amountOut, , , gasEstimate] = result;
    return { fee: args.fee, amountOut, gasEstimate };
  } catch {
    return null;
  }
}

/** Quote one explicit multi-hop path. null = some leg has no pool / no liquidity. */
export async function quotePath(
  client: PublicClient,
  args: { tokens: readonly `0x${string}`[]; fees: readonly number[]; amountIn: bigint },
): Promise<Quote | null> {
  try {
    const { result } = await client.simulateContract({
      address: PANCAKESWAP.v3QuoterV2 as `0x${string}`,
      abi: QUOTER_V2_ABI,
      functionName: "quoteExactInput",
      args: [encodePath(args.tokens, args.fees), args.amountIn],
    });
    const [amountOut, , , gasEstimate] = result;
    if (amountOut <= 0n) return null;
    return {
      fee: args.fees[0]!,
      amountOut,
      gasEstimate,
      path: { tokens: args.tokens, fees: args.fees },
    };
  } catch {
    return null;
  }
}

/** Scan all fee tiers concurrently and return the best executable quote. */
export async function bestQuote(
  client: PublicClient,
  args: { tokenIn: `0x${string}`; tokenOut: `0x${string}`; amountIn: bigint },
): Promise<Quote | null> {
  const quotes = await Promise.all(FEE_TIERS.map((fee) => quoteTier(client, { ...args, fee })));
  return pickBestQuote(quotes);
}

/**
 * Best executable quote allowing ONE intermediate hop through `via` (WBNB).
 *
 * Same reasoning as uniswap.ts's bestRoute: a token with no direct USDT pool
 * may still be reachable through a WBNB pool, so every direct tier and every
 * two-hop fee-tier combination is quoted and the best amountOut wins outright.
 */
export async function bestRoute(
  client: PublicClient,
  args: {
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
    amountIn: bigint;
    /** Intermediate token to try routing through. Omit to stay single-hop. */
    via?: `0x${string}`;
  },
): Promise<Quote | null> {
  const lc = (a: string) => a.toLowerCase();
  const direct = FEE_TIERS.map((fee) => quoteTier(client, { ...args, fee }));

  const viaUsable =
    args.via && lc(args.via) !== lc(args.tokenIn) && lc(args.via) !== lc(args.tokenOut);
  const hops = viaUsable
    ? FEE_TIERS.flatMap((a) =>
        FEE_TIERS.map((b) =>
          quotePath(client, {
            tokens: [args.tokenIn, args.via!, args.tokenOut],
            fees: [a, b],
            amountIn: args.amountIn,
          }),
        ),
      )
    : [];

  return pickBestQuote(await Promise.all([...direct, ...hops]));
}
