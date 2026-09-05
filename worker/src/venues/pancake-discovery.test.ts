import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PANCAKESWAP } from "../../../packages/core/src/protocols";
import { recentPools } from "./pancake-discovery";

const TOKEN_A = "0x00000000000000000000000000000000000000a1" as const;
const TOKEN_B = "0x00000000000000000000000000000000000000b2" as const;
const TOKEN_C = "0x00000000000000000000000000000000000000c3" as const;

/** A minimal stand-in for viem's PublicClient — only the methods this module calls. */
function fakeClient(opts: {
  latest: bigint;
  v2Logs?: { token0: `0x${string}`; token1: `0x${string}`; blockNumber: bigint; transactionHash: string }[];
  v3Logs?: { token0: `0x${string}`; token1: `0x${string}`; blockNumber: bigint; transactionHash: string }[];
}) {
  const v2 = opts.v2Logs ?? [];
  const v3 = opts.v3Logs ?? [];
  return {
    getBlockNumber: async () => opts.latest,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber }),
    getLogs: async ({ address }: { address: string }) => {
      const rows = address.toLowerCase() === (PANCAKESWAP.v2Factory as string).toLowerCase() ? v2 : v3;
      return rows.map((r) => ({ args: { token0: r.token0, token1: r.token1 }, blockNumber: r.blockNumber, transactionHash: r.transactionHash }));
    },
    // biome-ignore lint: test double, not the real type
  } as any;
}

describe("recentPools — direct-RPC BSC discovery", () => {
  it("reports a V2 PairCreated log as a candidate", async () => {
    const client = fakeClient({
      latest: 1000n,
      v2Logs: [{ token0: TOKEN_A, token1: TOKEN_B, blockNumber: 999n, transactionHash: "0xv2" }],
    });
    const out = await recentPools(client, { sinceMinutes: 60 });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.token, TOKEN_A.toLowerCase());
    assert.equal(out[0]!.quote, TOKEN_B.toLowerCase());
    assert.equal(out[0]!.txHash, "0xv2");
  });

  it("reports a V3 PoolCreated log as a candidate", async () => {
    const client = fakeClient({
      latest: 1000n,
      v3Logs: [{ token0: TOKEN_A, token1: TOKEN_C, blockNumber: 998n, transactionHash: "0xv3" }],
    });
    const out = await recentPools(client, { sinceMinutes: 60 });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.txHash, "0xv3");
  });

  it("merges both factories, newest first", async () => {
    const client = fakeClient({
      latest: 1000n,
      v2Logs: [{ token0: TOKEN_A, token1: TOKEN_B, blockNumber: 500n, transactionHash: "0xold" }],
      v3Logs: [{ token0: TOKEN_A, token1: TOKEN_C, blockNumber: 999n, transactionHash: "0xnew" }],
    });
    const out = await recentPools(client, { sinceMinutes: 60 });
    assert.equal(out.length, 2);
    assert.equal(out[0]!.txHash, "0xnew");
    assert.equal(out[1]!.txHash, "0xold");
  });

  it("degrades to an empty list when the RPC call fails, never throws", async () => {
    const client = {
      getBlockNumber: async () => {
        throw new Error("rpc down");
      },
    } as any; // biome-ignore lint: test double
    const out = await recentPools(client, { sinceMinutes: 60 });
    assert.deepEqual(out, []);
  });

  it("still decodes a log whose args arrive as a positional array, not a named object", async () => {
    // This is the exact shape a real BSC node returned live (2026-09-05): an
    // event with an unnamed trailing param makes viem decode `args` as
    // [token0, token1, ...] instead of {token0, token1, ...}. A version of
    // this module that only read log.args.token0 silently found zero
    // candidates against 132 real on-chain hits — this test is what would
    // have caught it.
    const client = {
      getBlockNumber: async () => 1000n,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber }),
      getLogs: async ({ address }: { address: string }) => {
        if (address.toLowerCase() !== (PANCAKESWAP.v2Factory as string).toLowerCase()) return [];
        return [{ args: [TOKEN_A, TOKEN_B, "0xpairaddr", 1n], blockNumber: 999n, transactionHash: "0xarr" }];
      },
      // biome-ignore lint: test double, not the real type
    } as any;
    const out = await recentPools(client, { sinceMinutes: 60 });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.token, TOKEN_A.toLowerCase());
    assert.equal(out[0]!.quote, TOKEN_B.toLowerCase());
  });

  it("respects the limit", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      token0: TOKEN_A,
      token1: TOKEN_B,
      blockNumber: BigInt(900 + i),
      transactionHash: `0x${i}`,
    }));
    const client = fakeClient({ latest: 1000n, v2Logs: many });
    const out = await recentPools(client, { sinceMinutes: 60, limit: 5 });
    assert.equal(out.length, 5);
  });
});
