/**
 * READ-ONLY: are there Uniswap v4 pools on Robinhood Chain we can actually reach?
 *
 * v4 has no factory to enumerate. Every pool lives inside one PoolManager and is
 * identified by a PoolKey (currency0, currency1, fee, tickSpacing, hooks) hashed
 * into a poolId. So a pool is FOUND by computing the id of a key you guessed and
 * asking StateView whether it's initialized.
 *
 * That works for vanilla pools. It cannot work for hooked ones — Pons/Doppler
 * launches attach a hook contract whose address is unguessable — and knowing
 * which of those two worlds this chain's liquidity lives in decides whether v4
 * execution is useful on its own or needs Bitquery discovery first.
 *
 *   npx tsx scripts/probe-v4-pools.mts
 */

import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi } from "viem";
import { CASH, STOCK_TOKENS, UNISWAP, bscChain } from "../packages/core/src/index";

const client = createPublicClient({ chain: bscChain, transport: http() });

const STATE_VIEW_ABI = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

/** Standard fee → tickSpacing pairs Uniswap ships. Hooked pools may use others. */
const FEE_TIERS: [number, number][] = [
  [100, 1],
  [500, 10],
  [3000, 60],
  [10000, 200],
];

const ZERO_HOOKS = "0x0000000000000000000000000000000000000000" as const;

export interface PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

/** PoolKey → poolId. keccak256 of the abi-encoded struct, exactly as v4 does it. */
function poolId(k: PoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
        },
      ],
      [k],
    ),
  );
}

/** v4 sorts currencies by address; native ETH is address(0) and sorts first. */
function sortedKey(a: `0x${string}`, b: `0x${string}`, fee: number, tickSpacing: number, hooks: `0x${string}` = ZERO_HOOKS): PoolKey {
  const [c0, c1] = a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a];
  return { currency0: c0.toLowerCase() as `0x${string}`, currency1: c1.toLowerCase() as `0x${string}`, fee, tickSpacing, hooks };
}

async function probePair(label: string, a: `0x${string}`, b: `0x${string}`) {
  const found: string[] = [];
  for (const [fee, tickSpacing] of FEE_TIERS) {
    const key = sortedKey(a, b, fee, tickSpacing);
    const id = poolId(key);
    try {
      const slot0 = (await client.readContract({
        address: UNISWAP.v4StateView as `0x${string}`,
        abi: STATE_VIEW_ABI,
        functionName: "getSlot0",
        args: [id],
      })) as readonly [bigint, number, number, number];
      if (slot0[0] === 0n) continue; // not initialized
      const liq = (await client.readContract({
        address: UNISWAP.v4StateView as `0x${string}`,
        abi: STATE_VIEW_ABI,
        functionName: "getLiquidity",
        args: [id],
      })) as bigint;
      found.push(`fee ${String(fee).padStart(5)} / ts ${String(tickSpacing).padStart(3)}  liquidity ${liq}`);
    } catch {
      /* uninitialized ids revert on some builds — same as "no pool" */
    }
  }
  console.log(`${label.padEnd(16)} ${found.length ? found.join("\n" + " ".repeat(17)) : "no vanilla (hookless) v4 pool at standard tiers"}`);
  return found.length;
}

async function main() {
  console.log(`\nRobinhood Chain ${bscChain.id} @ block ${await client.getBlockNumber()}`);
  console.log(`PoolManager ${UNISWAP.v4PoolManager}`);
  console.log(`StateView   ${UNISWAP.v4StateView}\n`);

  const USDG = CASH.USDT as `0x${string}`;
  const WETH = CASH.WBNB as `0x${string}`;
  const NATIVE = "0x0000000000000000000000000000000000000000" as const;

  let total = 0;
  total += await probePair("USDG/WETH", USDG, WETH);
  total += await probePair("ETH/USDG", NATIVE, USDG);
  total += await probePair("ETH/WETH", NATIVE, WETH);
  for (const sym of ["NVDA", "QQQ", "TSLA", "AAPL", "SPY", "GME"]) {
    const t = STOCK_TOKENS.find((x) => x.symbol === sym);
    if (!t) continue;
    total += await probePair(`${sym}/USDG`, t.address, USDG);
    total += await probePair(`${sym}/WETH`, t.address, WETH);
  }

  console.log(`\n── verdict ────────────────────────────────────────────────`);
  console.log(`vanilla v4 pools found at standard tiers: ${total}`);
  if (total === 0) {
    console.log(`\nNothing reachable by guessing a PoolKey. Either the liquidity is on v3`);
    console.log(`(which merrymen already trades), or the v4 pools here are HOOKED — and a`);
    console.log(`hook address cannot be guessed, so those need Bitquery's Initialize events`);
    console.log(`to discover the real PoolKey before any of them can be quoted or traded.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
