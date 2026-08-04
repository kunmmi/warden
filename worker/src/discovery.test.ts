/**
 * Discovery is the one path where a THIRD PARTY's data reaches a message the
 * owner reads and may act on. So the tests care about two things: that it picks
 * the right side of a pair, and that nothing an attacker controls — a token
 * symbol, a malformed event — gets through unshaped.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CASH } from "../../packages/core/src/index";
import { describeDiscovery, newTokenOf, sanitizeSymbol, type Discovery } from "./discovery";

const USDG = (CASH.USDT as string).toLowerCase() as `0x${string}`;
const WETH = (CASH.WBNB as string).toLowerCase() as `0x${string}`;
const CATE = "0x00000000000000000000000000000000000000c1" as const;
const DOGE = "0x00000000000000000000000000000000000000d0" as const;

const pair = (a: `0x${string}`, b: `0x${string}`) => ({
  token: a,
  quote: b,
  symbol: "",
  decimals: 18,
  protocol: "uniswap",
  createdAt: 1,
  txHash: "0x",
});

describe("newTokenOf — which side actually launched", () => {
  it("picks the non-cash side, whichever order it arrives in", () => {
    assert.equal(newTokenOf(pair(CATE, USDG)), CATE);
    assert.equal(newTokenOf(pair(USDG, CATE)), CATE);
    assert.equal(newTokenOf(pair(CATE, WETH)), CATE);
    assert.equal(newTokenOf(pair(WETH, CATE)), CATE);
  });

  it("says nothing about a cash/cash pool — USDG/WETH is not a launch", () => {
    assert.equal(newTokenOf(pair(USDG, WETH)), null);
    assert.equal(newTokenOf(pair(WETH, USDG)), null);
  });

  it("says nothing about an exotic pair with no cash leg", () => {
    // Nothing to value it against, so announcing it would be noise the owner
    // can't act on anyway.
    assert.equal(newTokenOf(pair(CATE, DOGE)), null);
  });

  it("treats native ETH as a cash side", () => {
    const NATIVE = "0x0000000000000000000000000000000000000000" as const;
    assert.equal(newTokenOf(pair(CATE, NATIVE)), CATE);
  });

  it("is case-insensitive about the cash addresses", () => {
    const upper = USDG.toUpperCase().replace("0X", "0x") as `0x${string}`;
    assert.equal(newTokenOf(pair(CATE, upper)), CATE);
  });
});

/**
 * A token's symbol is chosen by whoever deployed it and lands in a Telegram
 * message and an event line. Same reasoning as the memory sanitizers: strip
 * anything that could pass for markup or a list separator, and cap the length.
 */
describe("sanitizeSymbol", () => {
  it("keeps an ordinary ticker intact", () => {
    assert.equal(sanitizeSymbol("CATE"), "CATE");
    assert.equal(sanitizeSymbol("wstETH-1"), "wstETH-1");
  });

  it("strips markup, separators and whitespace", () => {
    assert.equal(sanitizeSymbol("<b>CATE</b>"), "bCATEb");
    assert.equal(sanitizeSymbol("CATE,NVDA"), "CATENVDA");
    assert.equal(sanitizeSymbol("CA TE"), "CATE");
    assert.equal(sanitizeSymbol("CATE\n/grant"), "CATEgrant");
  });

  it("caps the length so a symbol can't flood the message", () => {
    assert.equal(sanitizeSymbol("x".repeat(200)).length, 16);
  });

  it("never returns empty — an unnamed token still needs a label", () => {
    assert.equal(sanitizeSymbol(""), "?");
    assert.equal(sanitizeSymbol("<<<>>>"), "?");
  });
});

describe("describeDiscovery — what the owner is told", () => {
  const base: Discovery = {
    token: CATE,
    symbol: "CATE",
    decimals: 18,
    createdAt: 0,
    liquidityUsdg: 120_000_000_000n, // $120k
    priceable: true,
    price8: 100_000n,
    fdvUsd: 800_000,
  };

  it("names the token, its depth and whether it can be priced", () => {
    const s = describeDiscovery(base);
    assert.match(s, /CATE/);
    assert.match(s, /120,000/);
    assert.match(s, /deep enough/);
  });

  it("gives the guard's own reason when it can't be priced", () => {
    const s = describeDiscovery({ ...base, priceable: false, reason: "pool too thin: 300 USDG" });
    assert.match(s, /can't price it yet/);
    assert.match(s, /too thin/);
  });

  it("handles an unpriceable pool with no depth reading at all", () => {
    const s = describeDiscovery({ ...base, liquidityUsdg: null, priceable: false, reason: "no route to USDG yet" });
    assert.match(s, /depth unknown/);
    assert.match(s, /no route/);
  });

  it("shows a truncated address so the owner can look it up", () => {
    assert.match(describeDiscovery(base), /0x00000000…/);
  });
});
