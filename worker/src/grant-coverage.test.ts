/**
 * The tradable set is sealed into a signed session key, so "the owner listed a
 * token" and "the agent may sell that token" are two different facts. This is
 * the function that keeps them apart — get it wrong in the permissive direction
 * and the owner is told they can exit a memecoin they actually cannot.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CASH,
  LEGACY_TRADEABLE_SYMBOLS,
  STOCK_TOKENS,
  TRADEABLE_SYMBOLS,
  TRADEABLE_V2,
  builtinGrantTargets,
  sellableAssets,
  tokenCoverage,
  uncoveredBasketSymbols,
  type CustomToken,
} from "../../packages/core/src/index";

const CATE: CustomToken = {
  symbol: "CATE",
  address: "0x00000000000000000000000000000000000000c1",
  decimals: 18,
};
const DOGE: CustomToken = {
  symbol: "DOGE",
  address: "0x00000000000000000000000000000000000000d0",
  decimals: 9,
};

/** A grant signed by the CURRENT issuer — carries the wide stock allowlist. */
const grantWith = (...addrs: string[]) => ({ grantTokens: addrs, grantFeatures: ["transfer", TRADEABLE_V2] });
/** A grant signed before 2026-07-27 — only the legacy three in its call policy. */
const legacyGrant = (...addrs: string[]) => ({ grantTokens: addrs, grantFeatures: ["transfer"] });
const stock = (symbol: string) => STOCK_TOKENS.find((t) => t.symbol === symbol)!;
const symbols = (list: CustomToken[]) => list.map((t) => t.symbol);

describe("tokenCoverage", () => {
  it("reports a listed-but-unsigned token as uncovered", () => {
    const { covered, uncovered } = tokenCoverage([CATE], grantWith());
    assert.deepEqual(symbols(covered), []);
    assert.deepEqual(symbols(uncovered), ["CATE"]);
  });

  it("reports a token the grant actually names as covered", () => {
    const { covered, uncovered } = tokenCoverage([CATE], grantWith(CATE.address));
    assert.deepEqual(symbols(covered), ["CATE"]);
    assert.deepEqual(symbols(uncovered), []);
  });

  it("splits a mixed set instead of judging it as a whole", () => {
    const { covered, uncovered } = tokenCoverage([CATE, DOGE], grantWith(CATE.address));
    assert.deepEqual(symbols(covered), ["CATE"]);
    assert.deepEqual(symbols(uncovered), ["DOGE"]);
  });

  it("matches addresses case-insensitively — a checksummed entry is the same token", () => {
    const mixed = { ...CATE, address: CATE.address.toUpperCase().replace("0X", "0x") as `0x${string}` };
    assert.deepEqual(symbols(tokenCoverage([mixed], grantWith(CATE.address)).covered), ["CATE"]);
    assert.deepEqual(
      symbols(tokenCoverage([CATE], grantWith(CATE.address.toUpperCase())).covered),
      ["CATE"],
    );
  });

  it("treats a grant with NO grantTokens field as covering nothing extra", () => {
    // A grant signed before extras existed has no extra approve permission in
    // its call policy, so "field missing" and "nothing covered" are the same
    // fact. Reading absence as "unknown, assume fine" would be the dangerous
    // direction: the owner would be told they can sell, and the op would revert.
    assert.deepEqual(symbols(tokenCoverage([CATE], {}).uncovered), ["CATE"]);
    assert.deepEqual(symbols(tokenCoverage([CATE], null).uncovered), ["CATE"]);
    assert.deepEqual(symbols(tokenCoverage([CATE], undefined).uncovered), ["CATE"]);
  });

  it("never flags what the grant already approves — USDG and its own built-in tradables", () => {
    // These are in the call policy unconditionally, so the issuer drops them
    // from grantTokens. If coverage didn't know that, listing WBNB in settings
    // would produce a permanent "re-sign" nag that re-signing cannot clear.
    const usdg: CustomToken = { symbol: "USDG", address: CASH.USDT as `0x${string}`, decimals: 18 };
    const wbnb = stock("WBNB");
    const entry: CustomToken = { symbol: wbnb.symbol, address: wbnb.address, decimals: 18 };
    assert.deepEqual(symbols(tokenCoverage([usdg, entry], grantWith()).uncovered), []);
    // WBNB is in the legacy set too, so an old grant is equally clean.
    assert.deepEqual(symbols(tokenCoverage([usdg, entry], legacyGrant()).uncovered), []);
  });

  it("is empty-safe in both directions", () => {
    assert.deepEqual(tokenCoverage([], grantWith(CATE.address)).uncovered, []);
    assert.deepEqual(tokenCoverage([], null).covered, []);
  });
});

describe("builtinGrantTargets", () => {
  it("with no grant, answers for a signature minted RIGHT NOW — the wide set", () => {
    const set = builtinGrantTargets();
    assert.equal(set.has((CASH.USDT as string).toLowerCase()), true);
    for (const sym of TRADEABLE_SYMBOLS) {
      assert.equal(set.has(stock(sym).address.toLowerCase()), true, `${sym} missing`);
    }
    for (const a of set) assert.equal(a, a.toLowerCase());
  });

  /**
   * The heart of the fix. TRADEABLE_SYMBOLS grows as pools are seeded, but a key
   * signed last month has last month's list sealed in its call policy. Reading
   * the current constant for an old grant is what let BTCB be bought and never
   * sold once its pool appeared.
   */
  it("credits an OLD grant with only the legacy set, not today's wider one", () => {
    const old = builtinGrantTargets(legacyGrant());
    assert.equal(old.has(stock("WBNB").address.toLowerCase()), true, "legacy grants did carry WBNB");
    assert.equal(
      old.has(stock("BTCB").address.toLowerCase()),
      false,
      "BTCB's pool appeared AFTER this grant was signed — its policy cannot approve it",
    );
  });

  it("credits a re-signed grant with the wide set", () => {
    assert.equal(builtinGrantTargets(grantWith()).has(stock("BTCB").address.toLowerCase()), true);
  });

  it("treats a missing grantFeatures as legacy — absence is not permission", () => {
    for (const g of [null, {}, { grantFeatures: undefined }, { grantFeatures: ["transfer"] }]) {
      assert.equal(
        builtinGrantTargets(g).has(stock("BTCB").address.toLowerCase()),
        false,
        `${JSON.stringify(g)} must not be credited with the wide set`,
      );
    }
  });

  // merrymen's original registry (24 Robinhood stock tokens) had entries like
  // PLTR with no v3 pool at all, so a "registry has it, no set approves it"
  // case existed. Warden's v0 registry is a small, deliberately curated list
  // of already-liquid BSC tokens (see tokens.ts) — every registry entry has a
  // route by construction, so that case doesn't apply here. Removed rather
  // than faked; re-add if the registry ever grows to include unrouted tokens.

  it("the legacy set is a strict subset of today's — the list only ever grows", () => {
    for (const sym of LEGACY_TRADEABLE_SYMBOLS) {
      assert.ok(
        (TRADEABLE_SYMBOLS as readonly string[]).includes(sym),
        `${sym} was dropped — a re-sign would REVOKE an exit that used to work`,
      );
    }
  });
});

/**
 * The trap in plain terms: /settings offers every registry symbol as a basket
 * option, approving USDG is generic so the BUY works for anything with a pool,
 * and only the symbols sealed into the signature can be approved for a SELL.
 * That asymmetry is a one-way door, and it needs naming before it's walked into.
 */
describe("uncoveredBasketSymbols", () => {
  it("names a basket stock an OLD grant cannot sell", () => {
    assert.deepEqual(uncoveredBasketSymbols(["WBNB", "BTCB"], legacyGrant()), ["BTCB"]);
  });

  it("is silent once the grant is re-signed", () => {
    assert.deepEqual(uncoveredBasketSymbols(["WBNB", "BTCB"], grantWith()), []);
  });

  it("is silent on the default basket for legacy grants — no nag for existing users", () => {
    // The default basket stayed at the legacy set precisely so upgrading
    // doesn't hand every existing user a warning they didn't cause.
    assert.deepEqual(uncoveredBasketSymbols([...LEGACY_TRADEABLE_SYMBOLS], legacyGrant()), []);
  });

  it("ignores symbols that aren't in the registry at all", () => {
    assert.deepEqual(uncoveredBasketSymbols(["NOPE", "WBNB"], legacyGrant()), []);
  });

  it("treats no grant as covering nothing beyond the legacy set", () => {
    assert.deepEqual(uncoveredBasketSymbols(["BTCB"], null), ["BTCB"]);
  });
});

describe("sellableAssets", () => {
  it("unions the grant's built-in set with its owner-added extras", () => {
    const set = sellableAssets(grantWith(CATE.address));
    assert.equal(set.has(CATE.address), true);
    assert.equal(set.has(stock("BTCB").address.toLowerCase()), true);
    assert.equal(set.has((CASH.USDT as string).toLowerCase()), true);
  });

  it("an old grant's extras still count, but its stock set stays narrow", () => {
    const set = sellableAssets(legacyGrant(CATE.address));
    assert.equal(set.has(CATE.address), true, "extras are recorded per-grant, not per-version");
    assert.equal(set.has(stock("BTCB").address.toLowerCase()), false);
  });

  it("a null grant can sell nothing beyond the legacy built-ins", () => {
    const set = sellableAssets(null);
    assert.equal(set.has(stock("WBNB").address.toLowerCase()), true);
    assert.equal(set.has(stock("BTCB").address.toLowerCase()), false);
    assert.equal(set.has(CATE.address), false);
  });
});
