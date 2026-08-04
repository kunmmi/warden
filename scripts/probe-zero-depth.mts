/**
 * Several live pools report a sane TWAP but ZERO depth. Before trusting that,
 * check it isn't our own liquidity() read failing and being swallowed by the
 * .catch(() => 0n) in readPoolPrice — "the call reverted" and "there is no
 * in-range liquidity" would look identical downstream, and only one of them is
 * a reason to refuse the token.
 */
import { createPublicClient, http, parseAbi } from "viem";
import { CASH, UNISWAP, bscChain } from "../packages/core/src/index";

const client = createPublicClient({ chain: bscChain, transport: http() });
const FACTORY = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const POOL = parseAbi([
  "function liquidity() view returns (uint128)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
]);
const ERC20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function symbol() view returns (string)"]);

// Reported a price but $0 depth in the main probe.
const SUSPECTS: `0x${string}`[] = [
  "0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34", // USDe (placeholder — resolved below)
];

async function main() {
  // Re-discover, so the addresses come from the chain rather than being pasted.
  // TODO(BSC): wrong host — Robinhood Chain's Blockscout API, not usable on
  // BSC. See the same TODO in probe-pool-prices.mts; don't guess a
  // replacement endpoint, verify one first (docs/VERIFICATION.md).
  const res = await fetch("https://robinhoodchain.blockscout.com/api/v2/tokens?type=ERC-20");
  const j = (await res.json()) as { items?: { address?: string; address_hash?: string; symbol?: string }[] };
  const bySymbol = new Map<string, `0x${string}`>();
  for (const it of j.items ?? []) {
    const a = (it.address ?? it.address_hash ?? "").toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(a) && it.symbol) bySymbol.set(it.symbol, a as `0x${string}`);
  }

  const check = ["USDe", "Index", "KARMA", "ARROW", "HOODRAT", "CASHCAT", "NOC"];
  for (const sym of check) {
    const token = bySymbol.get(sym);
    if (!token) {
      console.log(`${sym.padEnd(10)} not in the explorer list`);
      continue;
    }
    for (const cash of [CASH.USDT, CASH.WBNB] as const) {
      for (const fee of [500, 3000, 10000]) {
        const pool = (await client.readContract({
          address: UNISWAP.v3Factory as `0x${string}`,
          abi: FACTORY,
          functionName: "getPool",
          args: [token, cash as `0x${string}`, fee],
        })) as `0x${string}`;
        if (/^0x0{40}$/i.test(pool)) continue;

        // Read liquidity WITHOUT a catch, so a revert is visible as a revert.
        let liq: string;
        try {
          liq = String(await client.readContract({ address: pool, abi: POOL, functionName: "liquidity" }));
        } catch (e) {
          liq = `REVERTED (${(e as Error).message.slice(0, 40)})`;
        }
        const bal = (await client.readContract({
          address: cash as `0x${string}`,
          abi: ERC20,
          functionName: "balanceOf",
          args: [pool],
        })) as bigint;
        const cashSym = (cash as string) === (CASH.USDT as string) ? "USDG" : "WETH";
        const scale = cashSym === "USDG" ? 1e6 : 1e18;
        console.log(
          `${sym.padEnd(10)} ${cashSym} ${String(fee).padStart(5)}  pool ${pool.slice(0, 10)}  ` +
            `liquidity=${liq.padEnd(24)} balanceOf=${(Number(bal) / scale).toFixed(4)} ${cashSym}`,
        );
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
