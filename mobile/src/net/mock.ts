import type { EquityPoint, FeedResponse, PositionRow, TradeRecord } from "./types";

/**
 * A mock feed that behaves like the real one.
 *
 * This exists because the app has no backend yet — the dashboard's /api routes all
 * assume single-tenant local state with no auth, so there is nothing a phone can
 * point at until the hosted API lands. Rather than block the whole UI on that, the
 * store, the diffing and the lists get built and measured against this.
 *
 * It is deliberately NOT random noise. To be useful for the thing it's here to
 * prove — that a live-updating list doesn't re-render rows that didn't change — it
 * has to produce realistic PARTIAL change: most rows steady, a couple ticking, a
 * new trade every few polls. Feed the store uniformly-random data and every row
 * changes every poll, which would hide exactly the bug the store is designed to
 * prevent.
 *
 * It also mimics the awkward parts of the real shape on purpose: a stale price, a
 * pool-sourced price next to chainlink ones, a rejected trade with a reject_rule,
 * and a paper fill with no tx_hash. Those are the cases that break naive UI.
 */

const SYMBOLS = [
  { symbol: "QQQ", price: 512.4, source: "chainlink" },
  { symbol: "NVDA", price: 178.22, source: "chainlink" },
  { symbol: "TSLA", price: 341.9, source: "chainlink" },
  { symbol: "MSFT", price: 498.11, source: "chainlink" },
  // A memecoin priced off a Uniswap TWAP — a thinner claim, and the UI says so.
  { symbol: "PIPECAT", price: 0.00042, source: "pool" },
];

/**
 * Weighted, not uniform. A trading agent overwhelmingly swaps; moving cash in and
 * out of the vault is occasional housekeeping. Picking uniformly from three kinds
 * made two thirds of the tape read "vault deposit" — which made the agent look
 * like it mostly shuffles its own cash around, and gave no sense of what the tape
 * shows on a normal day.
 */
const KINDS = [
  "swap",
  "swap",
  "swap",
  "swap",
  "swap",
  "swap",
  "vault-deposit",
  "vault-withdraw",
] as const;

let tick = 0;
let equity = 10_000;
const prices = new Map(SYMBOLS.map((s) => [s.symbol, s.price]));
const equityHistory: EquityPoint[] = [];
const trades: TradeRecord[] = [];

/** Deterministic pseudo-random, so successive runs are comparable when profiling. */
let seed = 1337;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

function isoAgo(secondsAgo: number): string {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

function stepPrices(): string[] {
  // Only SOME symbols move each tick. This is the whole point of the mock.
  const moved: string[] = [];
  for (const s of SYMBOLS) {
    if (rnd() > 0.45) continue;
    const p = prices.get(s.symbol)!;
    const drift = (rnd() - 0.5) * 0.004;
    prices.set(s.symbol, Math.max(p * (1 + drift), 1e-9));
    moved.push(s.symbol);
  }
  return moved;
}

function makePositions(): PositionRow[] {
  return SYMBOLS.map((s, i) => {
    const price = prices.get(s.symbol)!;
    const shares = [1.4, 6.2, 3.1, 0.9, 1_250_000][i];
    return {
      symbol: s.symbol,
      raw_balance: String(BigInt(Math.round(shares * 1e18))),
      ui_multiplier: String(10n ** 18n),
      price_usd: Math.round(price * 1e6) / 1e6,
      // NVDA is deliberately stale sometimes — a 24/5 feed on a weekend.
      price_stale: s.symbol === "NVDA" && tick % 7 === 0 ? 1 : 0,
      price_source: s.source,
      value_usdg: Math.round(shares * price * 1e6) / 1e6,
    };
  });
}

function maybeTrade(): void {
  // Roughly one new trade every three polls, so the tape grows visibly but the
  // list is mostly unchanged between polls.
  if (rnd() > 0.34) return;
  const kind = KINDS[Math.floor(rnd() * KINDS.length)];
  const sym = SYMBOLS[Math.floor(rnd() * SYMBOLS.length)].symbol;
  const roll = rnd();
  const status: TradeRecord["status"] =
    roll > 0.82 ? "rejected" : roll > 0.68 ? "paper" : roll > 0.06 ? "landed" : "reverted";
  const amount = Math.round((20 + rnd() * 180) * 100) / 100;
  trades.unshift({
    kind,
    sell_token: kind === "swap" ? "USDT" : null,
    buy_token: kind === "swap" ? sym : null,
    amount_usdg: amount,
    // A rejected trade never reaches the chain, and a paper fill never touches
    // it — both legitimately have no hash, which the UI has to handle.
    tx_hash:
      status === "landed" || status === "reverted"
        ? `0x${Array.from({ length: 64 }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("")}`
        : null,
    status,
    reject_rule: status === "rejected" ? (rnd() > 0.5 ? "per-trade-cap" : "no-exit") : null,
    sim_quote_out: null,
    sim_min_out: null,
    sim_fee_tier: kind === "swap" ? 3000 : null,
    sim_gas: null,
    created_at: new Date().toISOString(),
  });
  if (trades.length > 400) trades.length = 400;
}

/** One poll's worth of feed. Advances the simulation by a tick. */
export function mockFeed(): FeedResponse {
  tick += 1;
  stepPrices();
  maybeTrade();

  const positionsValue = makePositions().reduce((s, p) => s + p.value_usdg, 0);
  const cash = 1_500 + Math.sin(tick / 9) * 120;
  equity = Math.round((cash + positionsValue) * 1e6) / 1e6;
  equityHistory.push({
    cash_usdg: Math.round(cash * 1e6) / 1e6,
    vault_usdg: 500,
    equity_usdg: equity,
    at: new Date().toISOString(),
  });
  if (equityHistory.length > 240) equityHistory.shift();

  return {
    source: "sqlite",
    events: [
      { level: "ok", message: `tick ${tick} · sequencer up · 0 paused`, created_at: isoAgo(1) },
      { level: tick % 11 === 0 ? "warn" : "ok", message: tick % 11 === 0 ? "1 stale feed" : "all feeds fresh", created_at: isoAgo(30) },
    ],
    equity: equityHistory.slice(),
    positions: makePositions(),
    // Serve a WINDOW, like the real API, so the store's merge path is exercised
    // rather than a simple replace.
    trades: trades.slice(0, 60),
    financials: { hwm_usdg: 10_450, accrued_fee_usdg: 12.4 },
    agent: { name: "Robin", strategy: "steady-basket", basket: ["QQQ", "NVDA", "TSLA"] },
  };
}

/** For tests and for the profiling runs, so a session starts from a known point. */
export function resetMock(): void {
  tick = 0;
  seed = 1337;
  equity = 10_000;
  equityHistory.length = 0;
  trades.length = 0;
  for (const s of SYMBOLS) prices.set(s.symbol, s.price);
}
