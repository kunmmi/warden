/**
 * The trencher's two decisions. These tests are mostly about the ASYMMETRY:
 * entering must require every condition, leaving must require only one, and the
 * exits that precede a total loss (unpriceable, liquidity walking out) must fire
 * before the ordinary stop-loss ever gets a chance to.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TRENCHER_DEFAULTS,
  priceMoveBps,
  shouldEnter,
  shouldExit,
  type Candidate,
  type OpenPosition,
} from "./trencher";

const p8 = (v: number) => BigInt(Math.round(v * 1e8));

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  symbol: "CATE",
  token: "0x00000000000000000000000000000000000000c1",
  decimals: 18,
  priceable: true,
  liquidityUsd: 120_000,
  fdvUsd: 800_000,
  ageSec: 45 * 60,
  price8: p8(0.001),
  ...over,
});

const cfg = TRENCHER_DEFAULTS;
const NOW = 1_800_000_000;

describe("shouldEnter — every condition must hold", () => {
  it("accepts a candidate that clears everything", () => {
    assert.equal(shouldEnter(candidate(), cfg, NOW).enter, true);
  });

  it("REFUSES anything it has no trusted price for", () => {
    const v = shouldEnter(candidate({ priceable: false }), cfg, NOW);
    assert.equal(v.enter, false);
    assert.match(v.enter === false ? v.why : "", /no trusted price/);
    // It must not pin this on the guards alone: unpriceable ALSO covers "there
    // was no v3 pool to read at all", which is not a risk verdict, so the
    // reason has to admit that possibility rather than imply a judgment.
    assert.match(v.enter === false ? v.why : "", /no v3 pool/);
  });

  it("REFUSES a pool too thin to leave", () => {
    const v = shouldEnter(candidate({ liquidityUsd: 5_000 }), cfg, NOW);
    assert.equal(v.enter, false);
    assert.match(v.enter === false ? v.why : "", /deep/);
  });

  it("REFUSES both ends of the FDV band", () => {
    assert.equal(shouldEnter(candidate({ fdvUsd: 1_000 }), cfg, NOW).enter, false);
    assert.equal(shouldEnter(candidate({ fdvUsd: 50_000_000 }), cfg, NOW).enter, false);
  });

  it("REFUSES the first minutes — the window where anything happens", () => {
    const v = shouldEnter(candidate({ ageSec: 60 }), cfg, NOW);
    assert.equal(v.enter, false);
    assert.match(v.enter === false ? v.why : "", /too early/);
  });

  it("REFUSES something that isn't a new pair any more", () => {
    assert.equal(shouldEnter(candidate({ ageSec: 5 * 86_400 }), cfg, NOW).enter, false);
  });

  it("names a reason on every refusal — silence is indistinguishable from a broken feed", () => {
    for (const c of [
      candidate({ priceable: false }),
      candidate({ liquidityUsd: 0 }),
      candidate({ fdvUsd: 0 }),
      candidate({ fdvUsd: 1e12 }),
      candidate({ ageSec: 0 }),
      candidate({ ageSec: 1e9 }),
    ]) {
      const v = shouldEnter(c, cfg, NOW);
      assert.equal(v.enter, false);
      assert.ok(v.enter === false && v.why.length > 0);
    }
  });

  it("one failing condition is enough, even when the rest look excellent", () => {
    const great = candidate({ liquidityUsd: 5_000_000, fdvUsd: 400_000, ageSec: 3600 });
    assert.equal(shouldEnter(great, cfg, NOW).enter, true);
    assert.equal(shouldEnter({ ...great, priceable: false }, cfg, NOW).enter, false);
  });
});

const position = (over: Partial<OpenPosition> = {}): OpenPosition => ({
  symbol: "CATE",
  token: "0x00000000000000000000000000000000000000c1",
  entryPrice8: p8(0.001),
  entryLiquidityUsd: 120_000,
  entrySec: NOW - 3600,
  costUsdg: 5_000_000n,
  ...over,
});

describe("shouldExit — any one condition is enough", () => {
  const flat = { price8: p8(0.001), liquidityUsd: 120_000, nowSec: NOW };

  it("holds when nothing has broken", () => {
    assert.equal(shouldExit(position(), flat, cfg).exit, false);
  });

  it("LEAVES when it can no longer be priced, before anything else is checked", () => {
    const v = shouldExit(position(), { ...flat, price8: null }, cfg);
    assert.equal(v.exit, true);
    assert.match(v.exit === true ? v.why : "", /can't be priced/);
  });

  it("LEAVES when liquidity walks out — the shape a rug actually takes", () => {
    const v = shouldExit(position(), { ...flat, liquidityUsd: 40_000 }, cfg);
    assert.equal(v.exit, true);
    assert.match(v.exit === true ? v.why : "", /liquidity has left/);
  });

  it("checks the drain BEFORE the stop-loss — it precedes the price move", () => {
    // Liquidity gone AND price still flat: a stop-loss alone would not fire, and
    // by the time it did there might be no route out.
    const v = shouldExit(position(), { ...flat, liquidityUsd: 10_000 }, cfg);
    assert.equal(v.exit === true && /liquidity/.test(v.why), true);
  });

  it("stops out on a drawdown", () => {
    const v = shouldExit(position(), { ...flat, price8: p8(0.0005) }, cfg);
    assert.equal(v.exit, true);
    assert.match(v.exit === true ? v.why : "", /down/);
  });

  it("takes profit on the way up", () => {
    const v = shouldExit(position(), { ...flat, price8: p8(0.0025) }, cfg);
    assert.equal(v.exit, true);
    assert.match(v.exit === true ? v.why : "", /up/);
  });

  it("leaves after the maximum hold — a trench position isn't an investment", () => {
    const v = shouldExit(position({ entrySec: NOW - 10 * 86_400 }), flat, cfg);
    assert.equal(v.exit, true);
    assert.match(v.exit === true ? v.why : "", /past the window/);
  });

  it("tolerates an unreadable depth without forcing an exit on its own", () => {
    // Depth we couldn't read is not evidence of a drain. The price is still
    // good, so this holds — treating a failed read as a rug would churn.
    assert.equal(shouldExit(position(), { ...flat, liquidityUsd: null }, cfg).exit, false);
  });

  it("survives a zero entry depth without dividing by it", () => {
    const v = shouldExit(position({ entryLiquidityUsd: 0 }), { ...flat, liquidityUsd: 1 }, cfg);
    assert.equal(v.exit, false);
  });
});

describe("priceMoveBps", () => {
  it("measures both directions from entry", () => {
    assert.equal(priceMoveBps(p8(1), p8(2)), 10_000);
    assert.equal(priceMoveBps(p8(1), p8(0.5)), -5_000);
    assert.equal(priceMoveBps(p8(1), p8(1)), 0);
  });

  it("returns 0 on a zero entry rather than dividing by it", () => {
    assert.equal(priceMoveBps(0n, p8(1)), 0);
  });
});
