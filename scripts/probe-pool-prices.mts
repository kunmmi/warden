/**
 * READ-ONLY probe: does pool pricing actually work on Robinhood Chain?
 *
 * Everything in worker/src/venues is pinned by unit tests built from realistic
 * numbers, but "the arithmetic is right" and "this chain has pools we'd accept"
 * are different claims. This answers the second one against the live chain, so
 * the default depth floor is calibrated to reality rather than to a guess.
 *
 * Touches nothing: no keys, no grant, no writes. eth_call only.
 *
 *   npx tsx scripts/probe-pool-prices.mts
 */

import { createPublicClient, http, parseAbi } from "viem";
import { CASH, STOCK_TOKENS, bscChain } from "../packages/core/src/index";
import { poolPriceUsable, readRoutedPrice } from "../worker/src/venues/pool-price";
import { SETTINGS_DEFAULTS } from "../packages/core/src/settings";

const client = createPublicClient({ chain: bscChain, transport: http() });

const ERC20 = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

// TODO(BSC): wrong host — Robinhood Chain's Blockscout API, not usable on BSC.
// BscScan (bscscan.com) is BSC's real explorer but uses a different API shape
// (V2 API at api.bscscan.com requires an API key and doesn't expose an
// identical tokens/holders endpoint) — swap this out with a verified
// BscScan-equivalent call before relying on this probe script again, don't
// guess an endpoint. See docs/VERIFICATION.md.
const BLOCKSCOUT = "https://robinhoodchain.blockscout.com/api/v2";

interface Candidate {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  holders: number | null;
}

/** Ask the explorer what ERC-20s exist here, most-held first. */
async function discover(limit = 40): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const known = new Set(STOCK_TOKENS.map((t) => t.address.toLowerCase()));
  known.add((CASH.USDT as string).toLowerCase());
  known.add((CASH.WBNB as string).toLowerCase());
  try {
    const res = await fetch(`${BLOCKSCOUT}/tokens?type=ERC-20`);
    if (!res.ok) {
      console.log(`  ! explorer returned ${res.status}`);
      return out;
    }
    const j = (await res.json()) as {
      items?: { address?: string; address_hash?: string; symbol?: string; decimals?: string; holders?: string; holders_count?: string }[];
    };
    for (const it of j.items ?? []) {
      const address = (it.address ?? it.address_hash ?? "").toLowerCase();
      if (!/^0x[0-9a-f]{40}$/.test(address) || known.has(address)) continue;
      known.add(address);
      out.push({
        address: address as `0x${string}`,
        symbol: it.symbol ?? "?",
        decimals: Number(it.decimals ?? 18),
        holders: it.holders != null ? Number(it.holders) : it.holders_count != null ? Number(it.holders_count) : null,
      });
      if (out.length >= limit) break;
    }
  } catch (e) {
    console.log(`  ! explorer unreachable: ${(e as Error).message}`);
  }
  return out;
}

/** Read symbol/decimals straight from the contract — the explorer can be wrong. */
async function onChainMeta(address: `0x${string}`): Promise<{ symbol: string; decimals: number } | null> {
  try {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address, abi: ERC20, functionName: "symbol" }) as Promise<string>,
      client.readContract({ address, abi: ERC20, functionName: "decimals" }) as Promise<number>,
    ]);
    return { symbol, decimals: Number(decimals) };
  } catch {
    return null;
  }
}

const usd = (v: bigint) => `$${(Number(v) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const px = (v: bigint) => {
  const n = Number(v) / 1e8;
  return n === 0 ? "—" : n < 0.01 ? `$${n.toPrecision(4)}` : `$${n.toFixed(4)}`;
};

async function main() {
  const block = await client.getBlockNumber();
  console.log(`\nRobinhood Chain ${bscChain.id} @ block ${block}`);
  console.log(`guard defaults: floor ${SETTINGS_DEFAULTS.minPoolLiquidityUsdg.toLocaleString()} USD, band ${SETTINGS_DEFAULTS.maxPriceDivergenceBps}bps\n`);

  console.log("discovering ERC-20s from the explorer…");
  const discovered = await discover();
  console.log(`  found ${discovered.length}\n`);

  // Always probe $MERRYMEN and the tradable stocks — a known-good control.
  const controls: Candidate[] = [
    { address: "0xa15cd06dd305269a0f48bebeb30aa3588fba7b32", symbol: "MERRYMEN", decimals: 18, holders: null },
    ...STOCK_TOKENS.filter((t) => ["NVDA", "QQQ", "TSLA"].includes(t.symbol)).map((t) => ({
      address: t.address,
      symbol: t.symbol,
      decimals: 18,
      holders: null,
    })),
  ];

  const seen = new Set<string>();
  const targets = [...controls, ...discovered].filter((c) => {
    const k = c.address.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const guard = {
    minLiquidityUsdg: BigInt(SETTINGS_DEFAULTS.minPoolLiquidityUsdg) * 1_000_000n,
    maxDivergenceBps: SETTINGS_DEFAULTS.maxPriceDivergenceBps,
  };

  const rows: string[] = [];
  let priced = 0;
  let noPool = 0;
  const refusals: Record<string, number> = {};
  const depths: number[] = [];

  for (const t of targets) {
    const meta = (await onChainMeta(t.address)) ?? { symbol: t.symbol, decimals: t.decimals };
    let routed;
    try {
      routed = await readRoutedPrice(client, {
        token: t.address,
        tokenDecimals: meta.decimals,
        cash: CASH.USDT as `0x${string}`,
        cashDecimals: 18, // TODO: import USDT_DECIMALS from core once this probe script is repointed at live BSC pools
        weth: CASH.WBNB as `0x${string}`,
      });
    } catch (e) {
      rows.push(`${meta.symbol.padEnd(12)} ERROR  ${(e as Error).message.slice(0, 60)}`);
      continue;
    }
    if (!routed) {
      noPool++;
      rows.push(`${meta.symbol.padEnd(12)} ${String(meta.decimals).padStart(2)}dp  no v3 pool`);
      continue;
    }
    const verdict = poolPriceUsable(routed, guard);
    depths.push(Number(routed.liquidityUsdg) / 1e6);
    if (verdict.ok) priced++;
    else refusals[verdict.kind] = (refusals[verdict.kind] ?? 0) + 1;
    rows.push(
      `${meta.symbol.padEnd(12)} ${String(meta.decimals).padStart(2)}dp  ` +
        `${routed.route.padEnd(6)} twap ${px(routed.price8).padEnd(12)} spot ${px(routed.spot8).padEnd(12)} ` +
        `depth ${usd(routed.liquidityUsdg).padEnd(14)} div ${String(routed.divergenceBps).padStart(5)}bps  ` +
        (verdict.ok ? "ACCEPTED" : `refused: ${verdict.kind}`),
    );
  }

  console.log(rows.join("\n"));

  console.log(`\n── verdict ────────────────────────────────────────────────`);
  console.log(`probed ${targets.length}: ${priced} accepted, ${noPool} with no pool at all`);
  for (const [kind, n] of Object.entries(refusals)) console.log(`  refused ${kind}: ${n}`);
  if (depths.length) {
    const sorted = [...depths].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
    console.log(
      `depth distribution (USD): min $${Math.round(sorted[0]!).toLocaleString()}, ` +
        `median $${Math.round(pct(50)).toLocaleString()}, max $${Math.round(sorted[sorted.length - 1]!).toLocaleString()}`,
    );
    for (const floor of [1_000, 5_000, 10_000, 25_000, 50_000, 100_000]) {
      const n = sorted.filter((d) => d >= floor).length;
      console.log(`  floor $${floor.toLocaleString().padStart(7)} would admit ${n}/${sorted.length}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
