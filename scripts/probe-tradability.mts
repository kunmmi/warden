/**
 * READ-ONLY: of the tokens merrymen can now PRICE, how many can it actually TRADE?
 *
 * These are different questions and it would be easy to conflate them. Pricing
 * routes TOKEN -> WETH -> USDG when that's the deeper path. Execution calls
 * exactInputSingle, which is ONE hop. So a token whose only real pool is against
 * WETH can be valued perfectly and not bought or sold at all.
 *
 * This asks the quoter directly — the same call the executor makes — so the
 * answer is what would really happen, not what the code looks like it does.
 *
 *   npx tsx scripts/probe-tradability.mts
 */

import { createPublicClient, http, parseAbi } from "viem";
import { CASH, bscChain, STOCK_TOKENS } from "../packages/core/src/index";
import { bestRoute } from "../worker/src/venues/uniswap";
import { poolPriceUsable, readRoutedPrice } from "../worker/src/venues/pool-price";
import { SETTINGS_DEFAULTS } from "../packages/core/src/settings";

const client = createPublicClient({ chain: bscChain, transport: http() });
const ERC20 = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const USDG = CASH.USDT as `0x${string}`;
const WETH = CASH.WBNB as `0x${string}`;
// $10 at USDT's real BSC decimals (18, not Ethereum's 6) — a realistic first
// buy, small enough to route.
const TEN_USDG = 10n * 10n ** 18n;

async function discover(): Promise<`0x${string}`[]> {
  // TODO(BSC): wrong host — Robinhood Chain's Blockscout API, not usable on
  // BSC. See the same TODO in probe-pool-prices.mts; don't guess a
  // replacement endpoint, verify one first (docs/VERIFICATION.md).
  const res = await fetch("https://robinhoodchain.blockscout.com/api/v2/tokens?type=ERC-20");
  const j = (await res.json()) as { items?: { address?: string; address_hash?: string }[] };
  const skip = new Set([USDG.toLowerCase(), WETH.toLowerCase()]);
  const out: `0x${string}`[] = [];
  for (const it of j.items ?? []) {
    const a = (it.address ?? it.address_hash ?? "").toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(a) && !skip.has(a)) out.push(a as `0x${string}`);
  }
  return out;
}

async function main() {
  console.log(`\nRobinhood Chain ${bscChain.id} @ block ${await client.getBlockNumber()}`);
  console.log(`can merrymen TRADE what it can PRICE? (buy size $10)\n`);

  const guard = {
    minLiquidityUsdg: BigInt(SETTINGS_DEFAULTS.minPoolLiquidityUsdg) * 1_000_000n,
    maxDivergenceBps: SETTINGS_DEFAULTS.maxPriceDivergenceBps,
  };

  const tradableStocks = STOCK_TOKENS.filter((t) => ["NVDA", "QQQ", "TSLA"].includes(t.symbol)).map(
    (t) => t.address,
  );
  const targets = [...tradableStocks, ...(await discover())];

  let pricedAndTradable = 0;
  let pricedNotTradable = 0;
  const stranded: string[] = [];

  for (const token of targets) {
    let symbol = token.slice(0, 8);
    let decimals = 18;
    try {
      symbol = (await client.readContract({ address: token, abi: ERC20, functionName: "symbol" })) as string;
      decimals = Number(await client.readContract({ address: token, abi: ERC20, functionName: "decimals" }));
    } catch {
      continue; // not a readable ERC-20
    }

    const routed = await readRoutedPrice(client, {
      token,
      tokenDecimals: decimals,
      cash: USDG,
      cashDecimals: 18, // TODO: import USDT_DECIMALS from core once this probe script is repointed at live BSC pools
      weth: WETH,
    });
    if (!routed) continue;
    const verdict = poolPriceUsable(routed, guard);
    if (!verdict.ok) continue; // not priced → not our question

    // The exact calls the executor makes — BOTH directions, because a token you
    // can buy and not sell is the trap, not a feature.
    const buy = await bestRoute(client, { tokenIn: USDG, tokenOut: token, amountIn: TEN_USDG, via: WETH });
    const sell = await bestRoute(client, {
      tokenIn: token,
      tokenOut: USDG,
      amountIn: 10n ** BigInt(decimals), // one whole token
      via: WETH,
    });
    const canTrade = !!buy && buy.amountOut > 0n && !!sell && sell.amountOut > 0n;
    if (canTrade) pricedAndTradable++;
    else {
      pricedNotTradable++;
      stranded.push(symbol);
    }
    const how = buy?.path ? "via WETH" : "direct";
    console.log(
      `${symbol.padEnd(12)} priced via ${routed.route.padEnd(6)} ` +
        `depth $${(Number(routed.liquidityUsdg) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(12)}  ` +
        (canTrade
          ? `TRADABLE (${how})`
          : `NOT TRADABLE — buy=${buy ? "ok" : "no route"} sell=${sell ? "ok" : "no route"}`),
    );
  }

  console.log(`\n── verdict ────────────────────────────────────────────────`);
  console.log(`priced AND tradable today:  ${pricedAndTradable}`);
  console.log(`priced but NOT tradable:    ${pricedNotTradable}`);
  if (stranded.length) {
    console.log(`\nstranded (valued, cannot be bought or sold): ${stranded.join(", ")}`);
    console.log(`these need multi-hop execution (exactInput with a USDG->WETH->TOKEN path);`);
    console.log(`the router target is unchanged, so the signed grant already permits it.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
