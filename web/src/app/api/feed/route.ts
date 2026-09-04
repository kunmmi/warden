/**
 * Agent history for the dashboard: events + equity series, read from the
 * shared SQLite file the worker writes (.data/warden.db).
 */

import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { NextResponse } from "next/server";
import { homePaths } from "@/lib/home";
import { TRADEABLE_SYMBOLS, type StoredGrant, type WardenSettings } from "@warden/core";

const DEFAULT_BASKET = [...TRADEABLE_SYMBOLS];

export const dynamic = "force-dynamic";

const DB_FILE = homePaths.db();

export interface FeedEvent {
  level: "ok" | "warn" | "err";
  message: string;
  created_at: string;
}
export interface EquityPoint {
  cash_usdg: number;
  vault_usdg: number;
  equity_usdg: number;
  at: string;
}
export interface PositionRow {
  symbol: string;
  raw_balance: string;
  ui_multiplier: string;
  price_usd: number;
  price_stale: number;
  /**
   * 'chainlink' or 'pool'. A pool price is a Uniswap TWAP that passed the depth
   * and divergence guards — trustworthy enough to act on, but a thinner claim
   * than an external feed, and the UI says so rather than blurring them.
   */
  price_source: string;
  value_usdg: number;
}
export interface TradeRecord {
  kind: string;
  sell_token: string | null;
  buy_token: string | null;
  amount_usdg: number;
  tx_hash: string | null;
  status: "landed" | "reverted" | "rejected" | "paper";
  reject_rule: string | null;
  sim_quote_out: string | null;
  sim_min_out: string | null;
  sim_fee_tier: number | null;
  sim_gas: string | null;
  created_at: string;
}
export interface AgentFinancials {
  hwm_usdg: number;
  accrued_fee_usdg: number;
}
/** Live identity: the user-given name (soul, mirrored into the agents table by
 * the worker) + the strategy/basket actually configured in settings.json. */
export interface AgentIdentity {
  name: string;
  strategy: string;
  basket: string[];
}
export interface FeedResponse {
  source: "sqlite" | "none";
  events: FeedEvent[];
  equity: EquityPoint[];
  positions: PositionRow[];
  trades: TradeRecord[];
  financials: AgentFinancials | null;
  agent: AgentIdentity | null;
}

/**
 * The currently armed agent's id (= its smart account address), or null with
 * no grant. Every per-agent table (events/equity/positions/trades) is keyed
 * by agent_id, and a machine that's discarded and re-created a wallet has
 * more than one row in each — reading without this filter returns every
 * agent that ever existed on this machine, blended together (symbol
 * collisions across agents even produced a duplicate React key on the
 * positions list). Read fresh per request rather than cached, since arming a
 * new grant should be reflected on the very next poll.
 */
function currentAgentId(): string | null {
  try {
    const raw = readFileSync(homePaths.grant(), "utf8").replace(/^﻿/, "");
    const grant = JSON.parse(raw) as StoredGrant;
    return typeof grant?.smartAccount === "string" ? grant.smartAccount : null;
  } catch {
    return null;
  }
}

/** The configured strategy + basket, straight from settings.json (live). */
function readIdentitySettings(): { strategy: string; basket: string[] } {
  try {
    const raw = readFileSync(homePaths.settings(), "utf8").replace(/^﻿/, "");
    const s = JSON.parse(raw) as WardenSettings;
    return {
      strategy: typeof s.strategy === "string" && s.strategy ? s.strategy : "steady-basket",
      basket: Array.isArray(s.basketSymbols) && s.basketSymbols.length ? s.basketSymbols : DEFAULT_BASKET,
    };
  } catch {
    return { strategy: "steady-basket", basket: DEFAULT_BASKET };
  }
}

export async function GET() {
  if (!existsSync(DB_FILE)) {
    // No ledger yet — identity still resolves live from settings + default name.
    return NextResponse.json({
      source: "none",
      events: [],
      equity: [],
      positions: [],
      trades: [],
      financials: null,
      agent: { name: "Warden", ...readIdentitySettings() },
    } satisfies FeedResponse);
  }

  // Read-only open so the worker stays the single writer. Tolerate a DB the
  // worker hasn't fully initialized yet — missing tables read as empty.
  const db = new DatabaseSync(DB_FILE, { readOnly: true });
  try {
    const agentId = currentAgentId();
    let events: FeedEvent[] = [];
    let equity: EquityPoint[] = [];
    let positions: PositionRow[] = [];
    let trades: TradeRecord[] = [];
    let financials: AgentFinancials | null = null;
    let name = "Warden";
    // No armed grant = nothing "current" to scope these to. Every table below
    // is keyed by agent_id, so an unfiltered read would return every agent
    // this machine has ever created, blended together (this is what produced
    // a duplicate "WBNB" position row and a React key collision after
    // discarding one wallet and creating another).
    if (agentId) {
    try {
      events = db
        .prepare(
          `SELECT level, message, datetime(created_at, 'unixepoch') AS created_at
           FROM events WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT 40`,
        )
        .all(agentId) as unknown as FeedEvent[];
    } catch {
      /* table not created yet */
    }
    try {
      equity = db
        .prepare(
          `SELECT cash_usdg, vault_usdg, equity_usdg, datetime(at, 'unixepoch') AS at
           FROM (SELECT * FROM equity WHERE agent_id = ? ORDER BY at DESC, id DESC LIMIT 288)
           ORDER BY at ASC, id ASC`,
        )
        .all(agentId) as unknown as EquityPoint[];
    } catch {
      /* table not created yet */
    }
    try {
      positions = db
        .prepare(
          `SELECT symbol, raw_balance, ui_multiplier, price_usd, price_stale,
                  price_source, value_usdg
           FROM positions WHERE agent_id = ? ORDER BY value_usdg DESC`,
        )
        .all(agentId) as unknown as PositionRow[];
    } catch {
      // price_source arrives with a worker migration. The dashboard can be
      // running against a database the upgraded worker hasn't opened yet, and
      // losing the whole positions panel over a label would be a worse bug than
      // the missing label — so fall back to the shape that always existed.
      try {
        const legacy = db
          .prepare(
            `SELECT symbol, raw_balance, ui_multiplier, price_usd, price_stale, value_usdg
             FROM positions WHERE agent_id = ? ORDER BY value_usdg DESC`,
          )
          .all(agentId) as unknown as Omit<PositionRow, "price_source">[];
        positions = legacy.map((p) => ({ ...p, price_source: "chainlink" }));
      } catch {
        /* table not created yet */
      }
    }
    try {
      trades = db
        .prepare(
          `SELECT kind, sell_token, buy_token, amount_usdg, tx_hash, status, reject_rule,
                  sim_quote_out, sim_min_out, sim_fee_tier, sim_gas,
                  datetime(created_at, 'unixepoch') AS created_at
           FROM trades WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT 30`,
        )
        .all(agentId) as unknown as TradeRecord[];
    } catch {
      /* table not created yet */
    }
    try {
      const row = db
        .prepare(
          "SELECT name, hwm_usdg, accrued_fee_usdg FROM agents WHERE smart_account = ?",
        )
        .get(agentId) as ({ name: string } & AgentFinancials) | undefined;
      if (row) {
        financials = { hwm_usdg: row.hwm_usdg, accrued_fee_usdg: row.accrued_fee_usdg };
        if (typeof row.name === "string" && row.name) name = row.name;
      }
    } catch {
      /* columns not migrated yet */
    }
    }
    return NextResponse.json({
      source: "sqlite",
      events,
      equity,
      positions,
      trades,
      financials,
      agent: { name, ...readIdentitySettings() },
    } satisfies FeedResponse);
  } finally {
    db.close();
  }
}
