/**
 * PancakeSwap v3 — quoting (v0) and execution (v1, added 2026-08-06 alongside
 * the wall port — see D008 in docs/DECISIONS.md).
 *
 * The quoting half (encodePath/pickBestQuote/minOutWithSlippage) had no test
 * coverage before this file — it shipped in v0 exercised only indirectly
 * through pool-price.ts and index.ts. Covered here now that execution makes
 * a wrong quote or a wrong path encoding a real-money bug, not just a paper
 * one.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFunctionData, erc20Abi } from "viem";
import { PANCAKESWAP, PANCAKESWAP_SWAP_ROUTER_ABI } from "../../../packages/core/src/index";
import { buildSwapCall, buildTradeCalls, encodePath, minOutWithSlippage, pickBestQuote, type Quote } from "./pancakeswap-v3";

const USDT = "0x55d398326f99059fF775485246999027B3197955" as const;
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as const;
const CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82" as const;
const ME = "0x000000000000000000000000000000000000dEaD" as const;

describe("encodePath", () => {
  it("packs token(20) fee(3) token(20) with no separators", () => {
    const p = encodePath([USDT, CAKE], [2500]);
    assert.equal(p.length, 2 + (20 + 3 + 20) * 2);
    assert.equal(p.slice(2, 42), USDT.slice(2).toLowerCase());
    assert.equal(p.slice(42, 48), "0009c4", "2500 as 3 bytes big-endian");
    assert.equal(p.slice(48), CAKE.slice(2).toLowerCase());
  });

  it("packs a two-hop path", () => {
    const p = encodePath([USDT, WBNB, CAKE], [100, 10000]);
    assert.equal(p.length, 2 + (20 + 3 + 20 + 3 + 20) * 2);
    assert.equal(p.slice(42, 48), "000064", "100 — PancakeSwap's lowest tier, no Uniswap equivalent");
    assert.equal(p.slice(88, 94), "002710", "10000");
  });

  it("REFUSES a malformed path rather than encoding nonsense", () => {
    assert.throws(() => encodePath([USDT], [2500]));
    assert.throws(() => encodePath([USDT, CAKE], []));
    assert.throws(() => encodePath([USDT, CAKE], [500, 2500]));
    assert.throws(() => encodePath([], []));
  });
});

describe("minOutWithSlippage", () => {
  it("applies bps slippage with floor semantics", () => {
    assert.equal(minOutWithSlippage(10_000n, 100), 9_900n);
    assert.equal(minOutWithSlippage(999n, 100), 989n, "floors, never rounds up");
  });

  it("rejects out-of-range slippage", () => {
    assert.throws(() => minOutWithSlippage(1n, -1));
    assert.throws(() => minOutWithSlippage(1n, 10_000));
  });
});

describe("pickBestQuote", () => {
  const q = (fee: number, amountOut: bigint): Quote => ({ fee, amountOut, gasEstimate: 100_000n });

  it("picks the highest output across PancakeSwap's four tiers", () => {
    // 100/500/2500/10000 — different set from Uniswap's 500/3000/10000.
    const best = pickBestQuote([q(100, 90n), q(500, 120n), q(2500, 100n), q(10000, 80n)]);
    assert.equal(best?.fee, 500);
    assert.equal(best?.amountOut, 120n);
  });

  it("ignores zero-output and missing quotes", () => {
    assert.equal(pickBestQuote([null, q(500, 0n), null]), null);
    assert.equal(pickBestQuote([]), null);
  });

  it("carries the winning route's path through", () => {
    const hop = { tokens: [USDT, WBNB, CAKE] as const, fees: [100, 2500] as const };
    const withPath: Quote = { fee: 100, amountOut: 250n, gasEstimate: 1n, path: hop };
    assert.deepEqual(pickBestQuote([q(100, 100n), withPath])?.path, hop);
  });
});

describe("buildSwapCall — targets PancakeSwap's SwapRouter and carries a deadline", () => {
  const base = {
    tokenIn: USDT,
    tokenOut: CAKE,
    fee: 2500,
    recipient: ME,
    amountIn: 10_000_000n,
    minAmountOut: 42n,
    deadline: 1_800_000_000,
  };

  it("single-hop: exactInputSingle, 8 fields, deadline included", () => {
    const call = buildSwapCall(base);
    assert.equal(call.to, PANCAKESWAP.swapRouter);
    assert.equal(call.value, 0n);
    const d = decodeFunctionData({ abi: PANCAKESWAP_SWAP_ROUTER_ABI, data: call.data });
    assert.equal(d.functionName, "exactInputSingle");
    const p = d.args[0];
    assert.equal(p.tokenIn, USDT);
    assert.equal(p.tokenOut, CAKE);
    assert.equal(p.fee, 2500);
    assert.equal(p.recipient, ME);
    // The field Uniswap's SwapRouter02 dropped and PancakeSwap kept — see D008.
    assert.equal(p.deadline, BigInt(base.deadline));
    assert.equal(p.amountIn, base.amountIn);
    assert.equal(p.amountOutMinimum, base.minAmountOut);
    assert.equal(p.sqrtPriceLimitX96, 0n);
  });

  it("multi-hop: exactInput carries the path and the same deadline/minOut", () => {
    const hop = { tokens: [USDT, WBNB, CAKE] as const, fees: [100, 2500] as const };
    const call = buildSwapCall({ ...base, path: hop });
    const d = decodeFunctionData({ abi: PANCAKESWAP_SWAP_ROUTER_ABI, data: call.data });
    assert.equal(d.functionName, "exactInput", "must not collapse to single-hop");
    const p = d.args[0];
    assert.equal(p.path, encodePath(hop.tokens, hop.fees));
    assert.equal(p.deadline, BigInt(base.deadline));
    assert.equal(p.amountOutMinimum, base.minAmountOut, "the slippage bound must survive the switch");
    assert.equal(p.recipient.toLowerCase(), ME.toLowerCase());
  });

  it("targets the same router either way", () => {
    const single = buildSwapCall(base);
    const multi = buildSwapCall({ ...base, path: { tokens: [USDT, WBNB, CAKE], fees: [100, 500] } });
    assert.equal(single.to, multi.to);
    assert.equal(single.value, 0n);
    assert.equal(multi.value, 0n);
  });
});

describe("buildTradeCalls — approve then swap, nothing else (no Permit2 hop)", () => {
  const base = {
    tokenIn: USDT,
    tokenOut: CAKE,
    recipient: ME,
    amountIn: 10_000_000n,
    minAmountOut: 990n,
    deadline: 1_800_000_000,
  };
  const q = (over: Partial<Quote> = {}): Quote => ({ fee: 2500, amountOut: 1000n, gasEstimate: 1n, ...over });

  it("is exactly two calls: approve, then swap, both at the SwapRouter", () => {
    const calls = buildTradeCalls({ ...base, quote: q() });
    assert.equal(calls.length, 2, "no Permit2 middleman — PancakeSwap pulls tokens directly");
    assert.equal(calls[0]!.to, USDT);
    const approve = decodeFunctionData({ abi: erc20Abi, data: calls[0]!.data });
    assert.equal(approve.functionName, "approve");
    const [spender, amount] = approve.args as readonly [string, bigint];
    assert.equal(spender.toLowerCase(), (PANCAKESWAP.swapRouter as string).toLowerCase());
    assert.equal(amount, base.amountIn, "approves exactly the trade size, not max");
    assert.equal(calls[1]!.to.toLowerCase(), (PANCAKESWAP.swapRouter as string).toLowerCase());
  });

  it("honours a multi-hop path when the quote had one", () => {
    const hop = { tokens: [USDT, WBNB, CAKE] as const, fees: [100, 2500] as const };
    const calls = buildTradeCalls({ ...base, quote: q({ path: hop }) });
    const d = decodeFunctionData({ abi: PANCAKESWAP_SWAP_ROUTER_ABI, data: calls[1]!.data });
    assert.equal(d.functionName, "exactInput");
  });

  it("carries the deadline into the swap call", () => {
    const calls = buildTradeCalls({ ...base, quote: q() });
    const d = decodeFunctionData({ abi: PANCAKESWAP_SWAP_ROUTER_ABI, data: calls[1]!.data });
    assert.equal(d.args[0].deadline, BigInt(base.deadline));
  });
});
