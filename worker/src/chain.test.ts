import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chainForId, explorerFor, pimlicoBundlerUrl, bscChain, bscTestnet } from "../../packages/core/src/index";
import { bundlerChainMismatch } from "./settings";
import { readStatus, type StatusContext } from "./telegram/reads";

const statusCtx = (chainId: number | null): StatusContext => ({
  name: "Robin",
  strategy: "steady-basket",
  venue: "uniswap",
  paused: false,
  workerAliveSec: 0,
  grant: null,
  chainId,
  telegramMaxActionUsdg: 25,
});

describe("/status chain line — you always know which mode the band rides", () => {
  it("mainnet reads as REAL FUNDS", () => {
    assert.match(readStatus(statusCtx(bscChain.id)), /mainnet 56 · REAL FUNDS/);
  });
  it("testnet reads as practice only", () => {
    assert.match(readStatus(statusCtx(bscTestnet.id)), /testnet 97 — <b>practice only<\/b>/);
  });
  // People fund testnet, see 0, and think warden is broken. /status must say why.
  it("testnet explains that funded balances are neither used nor shown", () => {
    const out = readStatus({ ...statusCtx(bscTestnet.id), paperStartUsdg: 1000 });
    assert.match(out, /not used and not shown/);
    assert.match(out, /1000 USDG book/);
    assert.match(out, /switch to mainnet/);
  });
  it("mainnet shows no testnet explainer", () => {
    assert.doesNotMatch(readStatus(statusCtx(bscChain.id)), /not used and not shown/);
  });
  it("no grant → no chain line", () => {
    assert.doesNotMatch(readStatus(statusCtx(null)), /chain:/);
  });
});

describe("chainForId / explorerFor", () => {
  it("maps the two BSC chain ids", () => {
    assert.equal(chainForId(bscTestnet.id).id, bscTestnet.id);
    assert.equal(chainForId(bscChain.id).id, bscChain.id);
  });

  it("treats anything unknown as mainnet (the only real chain)", () => {
    assert.equal(chainForId(1).id, bscChain.id);
  });

  it("explorer URLs differ per chain", () => {
    assert.equal(explorerFor(bscTestnet.id), "https://testnet.bscscan.com");
    assert.equal(explorerFor(bscChain.id), "https://bscscan.com");
  });
});

describe("pimlicoBundlerUrl — the easy-path builder is always chain-correct", () => {
  it("stamps the grant's chain id into the URL, so the mismatch guard can't fire on it", () => {
    for (const id of [bscTestnet.id, bscChain.id]) {
      const url = pimlicoBundlerUrl(id, "pim_secret");
      assert.equal(url, `https://api.pimlico.io/v2/${id}/rpc?apikey=pim_secret`);
      // the generated URL always matches the chain it was built for
      assert.equal(bundlerChainMismatch(url, id), null);
    }
  });
  it("url-encodes the key so odd characters can't break the URL", () => {
    assert.match(pimlicoBundlerUrl(bscChain.id, "a b/c?d"), /apikey=a%20b%2Fc%3Fd$/);
  });
});

describe("bundlerChainMismatch — the silent-failure guard", () => {
  it("null when no bundler URL is set", () => {
    assert.equal(bundlerChainMismatch(undefined, bscChain.id), null);
    assert.equal(bundlerChainMismatch("", bscChain.id), null);
  });

  it("null when the URL's chain id matches the grant", () => {
    assert.equal(bundlerChainMismatch(`https://api.pimlico.io/v2/${bscTestnet.id}/rpc?apikey=x`, bscTestnet.id), null);
    assert.equal(bundlerChainMismatch(`https://api.pimlico.io/v2/${bscChain.id}/rpc?apikey=x`, bscChain.id), null);
  });

  it("flags a testnet bundler with a mainnet grant (and vice versa)", () => {
    assert.equal(bundlerChainMismatch(`https://api.pimlico.io/v2/${bscTestnet.id}/rpc?apikey=x`, bscChain.id), bscTestnet.id);
    assert.equal(bundlerChainMismatch(`https://api.pimlico.io/v2/${bscChain.id}/rpc?apikey=x`, bscTestnet.id), bscChain.id);
  });

  it("null when the URL names no known chain id (heuristic stays quiet)", () => {
    assert.equal(bundlerChainMismatch("https://my-custom-bundler.example.com/rpc", bscChain.id), null);
    assert.equal(bundlerChainMismatch("https://bundler.example.com/v2/1/rpc", bscTestnet.id), null);
  });

  it("catches chain ids passed as query params", () => {
    assert.equal(bundlerChainMismatch(`https://bundler.example.com/rpc?chain=${bscTestnet.id}`, bscChain.id), bscTestnet.id);
  });
});
