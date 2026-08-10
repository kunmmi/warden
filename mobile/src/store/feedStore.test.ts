import { beforeEach, describe, expect, it } from "vitest";
import { feedStore, ingest, ingestError, resetFeed } from "./feedStore";
import type { FeedResponse, PositionRow, TradeRecord } from "@/net/types";

/**
 * The identity-preservation tests.
 *
 * These are the load-bearing claim of the whole store. Every row in the app
 * subscribes to its OWN entry so that a price tick wakes one row instead of the
 * whole list — and that is only worth anything if `ingest` genuinely reuses the
 * previous object for rows that didn't change. If it quietly stopped doing that,
 * nothing would break, no test would fail, and the app would just get slower under
 * load. Exactly the kind of regression that needs a test rather than vigilance.
 *
 * So these assert on OBJECT IDENTITY (`toBe`), not on deep equality. A `toEqual`
 * here would pass against a store that rebuilds every row every poll, which is the
 * bug.
 */

const pos = (symbol: string, price: number, value: number): PositionRow => ({
  symbol,
  raw_balance: "1000000000000000000",
  ui_multiplier: "1000000000000000000",
  price_usd: price,
  price_stale: 0,
  price_source: "chainlink",
  value_usdg: value,
});

const trade = (hash: string | null, status: TradeRecord["status"], at: string): TradeRecord => ({
  kind: "swap",
  sell_token: "USDT",
  buy_token: "QQQ",
  amount_usdg: 50,
  tx_hash: hash,
  status,
  reject_rule: null,
  sim_quote_out: null,
  sim_min_out: null,
  sim_fee_tier: 3000,
  sim_gas: null,
  created_at: at,
});

const feed = (over: Partial<FeedResponse> = {}): FeedResponse => ({
  source: "sqlite",
  events: [],
  equity: [{ cash_usdg: 100, vault_usdg: 0, equity_usdg: 1000, at: "2026-07-30T00:00:00Z" }],
  positions: [],
  trades: [],
  financials: null,
  agent: { name: "Robin", strategy: "steady-basket", basket: ["QQQ"] },
  ...over,
});

beforeEach(() => resetFeed());

describe("ingest — position identity", () => {
  it("keeps the SAME object for a position that did not change", () => {
    const p = pos("QQQ", 500, 700);
    ingest(feed({ positions: [p] }));
    const first = feedStore.getState().positions.QQQ;

    // A second poll returning an equal-but-distinct object must not replace it.
    ingest(feed({ positions: [pos("QQQ", 500, 700)] }));
    const second = feedStore.getState().positions.QQQ;

    expect(second).toBe(first);
  });

  it("replaces only the row whose price moved, leaving siblings identical", () => {
    ingest(feed({ positions: [pos("QQQ", 500, 700), pos("NVDA", 178, 1100), pos("TSLA", 340, 300)] }));
    const before = { ...feedStore.getState().positions };

    ingest(feed({ positions: [pos("QQQ", 500, 700), pos("NVDA", 179.5, 1109), pos("TSLA", 340, 300)] }));
    const after = feedStore.getState().positions;

    // THE POINT: one row is new, the other two are the very same objects, so their
    // subscribers never re-render.
    expect(after.NVDA).not.toBe(before.NVDA);
    expect(after.NVDA.price_usd).toBe(179.5);
    expect(after.QQQ).toBe(before.QQQ);
    expect(after.TSLA).toBe(before.TSLA);
  });

  it("notices a change in staleness or price source, not just price", () => {
    ingest(feed({ positions: [pos("QQQ", 500, 700)] }));
    const first = feedStore.getState().positions.QQQ;

    // A feed going stale at an unchanged price is real news — the row must update
    // or the UI keeps claiming the number is fresh.
    ingest(feed({ positions: [{ ...pos("QQQ", 500, 700), price_stale: 1 }] }));
    expect(feedStore.getState().positions.QQQ).not.toBe(first);

    const stale = feedStore.getState().positions.QQQ;
    ingest(feed({ positions: [{ ...pos("QQQ", 500, 700), price_stale: 1, price_source: "pool" }] }));
    expect(feedStore.getState().positions.QQQ).not.toBe(stale);
  });

  it("keeps the symbols array identity when the set is unchanged", () => {
    ingest(feed({ positions: [pos("QQQ", 500, 700), pos("NVDA", 178, 1100)] }));
    const symbols = feedStore.getState().positionSymbols;

    // Prices move, membership doesn't — the list's `data` prop must not change.
    ingest(feed({ positions: [pos("QQQ", 501, 701), pos("NVDA", 179, 1101)] }));
    expect(feedStore.getState().positionSymbols).toBe(symbols);

    ingest(feed({ positions: [pos("QQQ", 501, 701)] }));
    expect(feedStore.getState().positionSymbols).not.toBe(symbols);
  });
});

describe("ingest — tape", () => {
  it("keeps tapeIds identity when a sliding window brings nothing new", () => {
    const a = trade("0xaaa", "landed", "2026-07-30T00:00:01Z");
    const b = trade("0xbbb", "landed", "2026-07-30T00:00:02Z");
    ingest(feed({ trades: [b, a] }));
    const ids = feedStore.getState().tapeIds;

    // The server re-sends the same rows, as a windowed endpoint does.
    ingest(feed({ trades: [b, a] }));
    expect(feedStore.getState().tapeIds).toBe(ids);
  });

  it("does not duplicate a row the server repeats across polls", () => {
    const a = trade("0xaaa", "landed", "2026-07-30T00:00:01Z");
    ingest(feed({ trades: [a] }));
    ingest(feed({ trades: [a] }));
    expect(feedStore.getState().tapeIds).toEqual(["0xaaa"]);
  });

  it("keeps rows that fell out of the server's window", () => {
    const old = trade("0xold", "landed", "2026-07-30T00:00:01Z");
    ingest(feed({ trades: [old] }));
    // Window slides past it — the row must not vanish and make the tape flicker.
    const fresh = trade("0xnew", "landed", "2026-07-30T00:00:09Z");
    ingest(feed({ trades: [fresh] }));

    expect(feedStore.getState().tapeIds).toEqual(["0xnew", "0xold"]);
  });

  it("updates a row when a paper fill becomes landed, but not otherwise", () => {
    // No hash yet, so the id is derived from the content fields.
    const paper = trade(null, "paper", "2026-07-30T00:00:01Z");
    ingest(feed({ trades: [paper] }));
    const id = feedStore.getState().tapeIds[0];
    const first = feedStore.getState().tape[id];

    ingest(feed({ trades: [trade(null, "paper", "2026-07-30T00:00:01Z")] }));
    expect(feedStore.getState().tape[id]).toBe(first);

    ingest(feed({ trades: [{ ...paper, status: "landed" }] }));
    expect(feedStore.getState().tape[id]).not.toBe(first);
    expect(feedStore.getState().tape[id].status).toBe("landed");
  });

  it("gives hashless trades distinct ids instead of collapsing them", () => {
    // Two rejected trades a second apart have no tx_hash. If the id were just the
    // kind, they would overwrite each other and the tape would lose one.
    const r1 = { ...trade(null, "rejected", "2026-07-30T00:00:01Z"), reject_rule: "no-exit" };
    const r2 = { ...trade(null, "rejected", "2026-07-30T00:00:02Z"), reject_rule: "no-exit" };
    ingest(feed({ trades: [r2, r1] }));
    expect(feedStore.getState().tapeIds).toHaveLength(2);
  });

  it("evicts from the tape MAP, not just the id array, past the cap", () => {
    // A cap that only trims ids leaks: the map grows forever and the app's memory
    // climbs for as long as it runs.
    const many = Array.from({ length: 340 }, (_, i) =>
      trade(`0x${String(i).padStart(64, "0")}`, "landed", `2026-07-30T00:${String(i % 60).padStart(2, "0")}:00Z`),
    );
    // Newest first, as the API sends them.
    ingest(feed({ trades: many.slice().reverse() }));

    const s = feedStore.getState();
    expect(s.tapeIds).toHaveLength(300);
    expect(Object.keys(s.tape)).toHaveLength(300);
    expect(Object.keys(s.tape).length).toBe(s.tapeIds.length);
  });
});

describe("ingest — equity and failure", () => {
  it("keeps the equity series identity when the numbers are unchanged", () => {
    const equity = [
      { cash_usdg: 100, vault_usdg: 0, equity_usdg: 1000, at: "2026-07-30T00:00:00Z" },
      { cash_usdg: 100, vault_usdg: 0, equity_usdg: 1010, at: "2026-07-30T00:00:05Z" },
    ];
    ingest(feed({ equity }));
    const series = feedStore.getState().equitySeries;

    // Same numbers, fresh array from the wire — the sparkline's memo must hold.
    ingest(feed({ equity: equity.map((p) => ({ ...p })) }));
    expect(feedStore.getState().equitySeries).toBe(series);
  });

  it("takes the LAST equity point as current, not the first", () => {
    ingest(
      feed({
        equity: [
          { cash_usdg: 10, vault_usdg: 0, equity_usdg: 900, at: "2026-07-30T00:00:00Z" },
          { cash_usdg: 20, vault_usdg: 5, equity_usdg: 1234, at: "2026-07-30T00:00:05Z" },
        ],
      }),
    );
    const s = feedStore.getState();
    expect(s.equityUsdg).toBe(1234);
    expect(s.cashUsdg).toBe(20);
    expect(s.vaultUsdg).toBe(5);
  });

  it("a failed poll keeps the last good numbers rather than blanking them", () => {
    ingest(feed({ positions: [pos("QQQ", 500, 700)] }));
    const before = feedStore.getState();

    ingestError("feed unreachable");
    const after = feedStore.getState();

    // A missed read is not news about the portfolio. Zeroing it would invent a
    // change that never happened.
    expect(after.equityUsdg).toBe(before.equityUsdg);
    expect(after.positions.QQQ).toBe(before.positions.QQQ);
    expect(after.lastError).toBe("feed unreachable");
    expect(after.lastOkAt).toBe(before.lastOkAt);
  });

  it("clears a previous error on the next good poll", () => {
    ingestError("boom");
    ingest(feed());
    expect(feedStore.getState().lastError).toBeNull();
  });

  it("distinguishes 'never read' from 'read, and empty'", () => {
    expect(feedStore.getState().source).toBeNull();
    ingest(feed({ source: "none" }));
    expect(feedStore.getState().source).toBe("none");
  });
});
