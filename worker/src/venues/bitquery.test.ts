/**
 * Two things matter here.
 *
 * The credential CHOICE — the owner's own key must always win over the shared
 * holder gateway, because it's their quota, their limits, and nobody else in the
 * path. And the PROTOCOL switch: against a personal key the client sends real
 * GraphQL, but the gateway takes a named query and builds the GraphQL itself.
 * Sending raw GraphQL to the gateway would be rejected; sending a bare name to
 * Bitquery would be a syntax error. Getting this backwards fails silently-ish
 * and only for holders, which is the worst way for it to fail.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WARDEN_GATEWAY_BITQUERY,
  parsePoolEvent,
  resolveBitquery,
} from "./bitquery";

describe("resolveBitquery — whose quota is this?", () => {
  it("prefers the owner's own key over the shared gateway", () => {
    const c = resolveBitquery({ bitqueryApiKey: "personal", merrymenToken: "mmk_x" })!;
    assert.equal(c.apiKey, "personal");
    assert.equal(c.viaGateway, undefined, "no third party in the path when they brought a key");
    assert.equal(c.endpoint, undefined, "straight to Bitquery");
  });

  it("falls back to the holder gateway when there's no personal key", () => {
    const c = resolveBitquery({ merrymenToken: "mmk_x" })!;
    assert.equal(c.apiKey, "mmk_x");
    assert.equal(c.viaGateway, true);
    assert.equal(c.endpoint, WARDEN_GATEWAY_BITQUERY);
  });

  it("honours a self-hosted gateway URL", () => {
    const c = resolveBitquery({ merrymenToken: "mmk_x", gatewayUrl: "http://localhost:8787/bitquery" })!;
    assert.equal(c.endpoint, "http://localhost:8787/bitquery");
  });

  it("returns null with neither — no discovery is honest, a broken client isn't", () => {
    assert.equal(resolveBitquery({}), null);
    assert.equal(resolveBitquery({ bitqueryApiKey: "", merrymenToken: "" }), null);
  });
});

describe("parsePoolEvent — third-party JSON reaching a trading agent", () => {
  const ok = {
    Block: { Time: "2026-07-27T12:00:00Z" },
    Transaction: { Hash: "0xabc" },
    Arguments: [
      { Name: "token0", Value: { address: "0x00000000000000000000000000000000000000c1" } },
      { Name: "token1", Value: { address: "0x00000000000000000000000000000000000000d0" } },
    ],
  };

  it("reads a well-formed event", () => {
    const p = parsePoolEvent(ok)!;
    assert.equal(p.token, "0x00000000000000000000000000000000000000c1");
    assert.equal(p.quote, "0x00000000000000000000000000000000000000d0");
    assert.equal(p.txHash, "0xabc");
    assert.ok(p.createdAt > 0);
  });

  it("lowercases addresses so downstream comparisons hold", () => {
    const upper = { ...ok, Arguments: ok.Arguments.map((a) => ({ ...a, Value: { address: a.Value.address.toUpperCase().replace("0X", "0x") } })) };
    assert.equal(parsePoolEvent(upper)?.token, ok.Arguments[0]!.Value.address);
  });

  it("returns null rather than throwing on anything malformed", () => {
    // A schema change upstream must degrade to "found nothing", never crash a
    // tick that is also responsible for selling the owner's positions.
    for (const bad of [
      null,
      undefined,
      "string",
      42,
      {},
      { Arguments: [] },
      { ...ok, Arguments: [ok.Arguments[0]] }, // only one address
      { ...ok, Block: { Time: "not-a-date" } },
      { ...ok, Block: {} },
      { ...ok, Arguments: [{ Name: "x", Value: { address: "0x123" } }, { Name: "y", Value: { address: "nope" } }] },
    ]) {
      assert.doesNotThrow(() => parsePoolEvent(bad));
      assert.equal(parsePoolEvent(bad), null, `should reject ${JSON.stringify(bad)?.slice(0, 40)}`);
    }
  });

  it("tolerates a missing tx hash without discarding the event", () => {
    const p = parsePoolEvent({ ...ok, Transaction: undefined });
    assert.equal(p?.txHash, "");
    assert.equal(p?.token, ok.Arguments[0]!.Value.address);
  });
});
