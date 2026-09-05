/**
 * New-pool discovery for BSC — the direct-RPC replacement for bitquery.ts.
 *
 * bitquery.ts exists because the ORIGINAL chain's launches went through
 * Uniswap v4 hooks with no discoverable per-pair contract, so only a paid
 * indexer could see them at all. BSC has no such problem: PancakeSwap V2 and
 * V3 pools are created by two fixed, well-known factory contracts, and a new
 * pair is a plain on-chain event — `PairCreated` (V2) / `PoolCreated` (V3).
 * Any public RPC can answer "what launched, and when" directly via
 * `eth_getLogs`, no account or key required — matching how discovery is
 * described everywhere else in this codebase: read-only, off the hot path,
 * degrades to "nothing found" rather than ever throwing into the trading loop.
 *
 * BSC's ~3s block time is what makes this practical. The reasoning that ruled
 * out raw log-scanning for site/lib/chain.ts's history reader was specific to
 * a chain producing a block every 0.1s — a one-hour window there needs 30x the
 * block range this does. At 3s/block, an hour is ~1,200 blocks: one
 * `eth_getLogs` call, comfortably under any public provider's range cap.
 *
 * ONE CATCH, discovered live: `bsc-dataseed.binance.org` — the RPC the rest of
 * this product already trusts for trading (worker/src/snapshot.ts's
 * mainnetClient) — answers ordinary calls fine but refuses `eth_getLogs`
 * outright ("limit exceeded" on any range, even a single block). Rather than
 * touch the RPC the trading path depends on, discovery gets its OWN client
 * via createDiscoveryClient() below, pointed at a provider that actually
 * serves logs (verified live against bsc.publicnode.com, 2026-09-05). Nothing
 * discovery finds is trusted for pricing or execution anyway — see the module
 * doc above — so a second, discovery-only RPC changes nothing about what this
 * feed is allowed to do.
 */

import { createPublicClient, http, parseAbiItem, type PublicClient } from "viem";
import { PANCAKESWAP } from "../../../packages/core/src/protocols";
import { bscChain } from "../../../packages/core/src/chain";

/** A getLogs-capable BSC RPC, independent of the trading path's client. */
const DEFAULT_LOGS_RPC = "https://bsc.publicnode.com";

/** A client specifically for new-pool discovery — see the module doc for why it's separate. */
export function createDiscoveryClient(rpcUrl: string = DEFAULT_LOGS_RPC): PublicClient {
  return createPublicClient({ chain: bscChain, transport: http(rpcUrl) }) as PublicClient;
}

// The trailing param MUST be named — an anonymous one makes viem decode `args`
// as a positional array instead of a named object, and `log.args.token0` would
// then silently be `undefined` for every single log (found live, 2026-09-05:
// getLogs returned 132 real hits, all decoded as {} because of this).
const PAIR_CREATED = parseAbiItem(
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256 pairIndex)",
);
const POOL_CREATED = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)",
);

/** Roughly 3s per BSC block — good enough to turn "N minutes back" into a block count. */
const SEC_PER_BLOCK = 3;
/** Conservative per-call range — well under any public provider's eth_getLogs cap. */
const MAX_BLOCK_RANGE = 2000n;

export interface NewPair {
  /** One side of the pair, lowercased. Caller decides which side is "new". */
  token: `0x${string}`;
  symbol: string;
  decimals: number;
  /** The other side of the pair, lowercased. */
  quote: `0x${string}`;
  protocol: string;
  /** Unix seconds — filled from the block timestamp. */
  createdAt: number;
  txHash: string;
}

/**
 * Pools created in the last `sinceMinutes`, across both PancakeSwap factories.
 *
 * Mirrors bitquery.ts's `recentPools` shape so discovery.ts can swap sources
 * without changing its own logic. `symbol`/`decimals` are left as placeholders
 * here — discovery.ts already reads those from the token contract itself
 * (an attacker-chosen event arg is not something to trust for a display name),
 * so duplicating that read here would be wasted work.
 */
export async function recentPools(
  client: PublicClient,
  opts: { sinceMinutes?: number; limit?: number } = {},
): Promise<NewPair[]> {
  const sinceMinutes = opts.sinceMinutes ?? 60;
  const limit = Math.min(opts.limit ?? 25, 200);

  let latest: bigint;
  try {
    latest = await client.getBlockNumber();
  } catch {
    return []; // RPC hiccup — honest silence, not a crash of the trading loop
  }
  const spanBlocks = BigInt(Math.max(1, Math.round((sinceMinutes * 60) / SEC_PER_BLOCK)));
  const fromBlock = latest > spanBlocks ? latest - spanBlocks : 0n;

  type RawHit = { token0: `0x${string}`; token1: `0x${string}`; blockNumber: bigint; txHash: string; protocol: string };
  const hits: RawHit[] = [];

  // Both indexed params come first in both events' signatures, so the
  // positional shape (an anonymous trailing param, or a provider that just
  // doesn't decode names) still yields the right two addresses at [0]/[1] —
  // this only silently drops a log if BOTH shapes fail, not if just one does.
  function pairSides(args: unknown): [`0x${string}`, `0x${string}`] | null {
    if (Array.isArray(args)) {
      const [a, b] = args as unknown[];
      return typeof a === "string" && typeof b === "string" ? [a as `0x${string}`, b as `0x${string}`] : null;
    }
    const obj = args as { token0?: unknown; token1?: unknown } | undefined;
    return typeof obj?.token0 === "string" && typeof obj?.token1 === "string"
      ? [obj.token0 as `0x${string}`, obj.token1 as `0x${string}`]
      : null;
  }

  // Walk the window in bounded chunks, newest first, stopping once `limit` worth
  // of raw hits is collected. Timestamps are resolved AFTER, all at once, in
  // parallel — resolving them one `getBlock` at a time here made a single
  // discovery pass take minutes on a busy 30-minute BSC window.
  let chunkEnd = latest;
  while (chunkEnd >= fromBlock && hits.length < limit) {
    const chunkStart = chunkEnd - MAX_BLOCK_RANGE + 1n > fromBlock ? chunkEnd - MAX_BLOCK_RANGE + 1n : fromBlock;

    const [v2Logs, v3Logs] = await Promise.all([
      client
        .getLogs({ address: PANCAKESWAP.v2Factory as `0x${string}`, event: PAIR_CREATED, fromBlock: chunkStart, toBlock: chunkEnd })
        .catch(() => []),
      client
        .getLogs({ address: PANCAKESWAP.v3Factory as `0x${string}`, event: POOL_CREATED, fromBlock: chunkStart, toBlock: chunkEnd })
        .catch(() => []),
    ]);

    for (const log of v2Logs) {
      const sides = pairSides(log.args);
      if (!sides) continue;
      hits.push({ token0: sides[0], token1: sides[1], blockNumber: log.blockNumber, txHash: log.transactionHash, protocol: "pancakeswap-v2" });
    }
    for (const log of v3Logs) {
      const sides = pairSides(log.args);
      if (!sides) continue;
      hits.push({ token0: sides[0], token1: sides[1], blockNumber: log.blockNumber, txHash: log.transactionHash, protocol: "pancakeswap-v3" });
    }

    if (chunkStart === fromBlock) break;
    chunkEnd = chunkStart - 1n;
  }

  // Block number is a fine proxy for chronological order (blocks ARE
  // chronological) — sort and cap to `limit` BEFORE resolving timestamps, so
  // a busy window doesn't spend one getBlock call per discarded hit. A busy
  // 45-minute window found ~130 raw hits for a limit of 25 live, 2026-09-05;
  // resolving all of them took 23s for 25 results actually kept.
  hits.sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : 0));
  const kept = hits.slice(0, limit);

  const uniqueBlocks = [...new Set(kept.map((h) => h.blockNumber))];
  const timestamps = await Promise.all(
    uniqueBlocks.map(async (bn) => {
      try {
        const block = await client.getBlock({ blockNumber: bn });
        return [bn, Number(block.timestamp)] as const;
      } catch {
        return [bn, 0] as const;
      }
    }),
  );
  const blockTime = new Map(timestamps);

  const out: NewPair[] = kept.map((h) => ({
    token: h.token0.toLowerCase() as `0x${string}`,
    quote: h.token1.toLowerCase() as `0x${string}`,
    symbol: `${h.token0.slice(0, 10)}…`,
    decimals: 18,
    protocol: h.protocol,
    createdAt: blockTime.get(h.blockNumber) ?? 0,
    txHash: h.txHash,
  }));

  out.sort((a, b) => b.createdAt - a.createdAt);
  return out.slice(0, limit);
}
