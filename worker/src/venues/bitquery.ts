/**
 * Bitquery — the eyes merrymen doesn't have.
 *
 * merrymen reads Uniswap **v3** directly: factory, pools, quoter. That is enough
 * to trade what already exists and blind to almost everything that's new. New
 * pairs on Robinhood Chain launch through Pons/Doppler on **Uniswap v4**, whose
 * pools live inside a singleton PoolManager with no per-pair contract to find by
 * scanning. Bitquery indexes this chain from genesis and decodes v4 events, so
 * it can answer "what launched, and when" — a question no amount of v3 reading
 * will ever answer.
 *
 * WHAT THIS IS ALLOWED TO BE. A discovery source, and nothing else. It can tell
 * the agent a pair exists; it can never authorise a trade in one. Everything it
 * returns is untrusted input on the PROPOSE side of the wall:
 *
 *   - No value from here reaches equity, P&L, the high-water mark or the
 *     drawdown breaker. Those still come from a pool TWAP that passed the depth
 *     and divergence guards, or from Chainlink.
 *   - A token Bitquery surfaces is still an owner-added token like any other:
 *     it must be added, selected, and covered by a re-signed grant before the
 *     agent can touch it. Discovery does not widen a cap, ever.
 *   - It is off the hot path. A slow or failing API must degrade to "no new
 *     information", never to a stalled tick.
 *
 * That last point is why every call here is bounded and every failure is a
 * caught, typed miss rather than a throw.
 */

import { WARDEN_GATEWAY_ORIGIN } from "../../../packages/core/src/index";

/** Bitquery's V2 (streaming) GraphQL endpoint — the one carrying EVM(network:). */
export const BITQUERY_DEFAULT_ENDPOINT = "https://streaming.bitquery.io/graphql";

/** This chain's identifier in Bitquery's EVM schema. */
export const BITQUERY_NETWORK = "robinhood";

/**
 * The shared holder gateway. A merryman with a Merry Circle token needs no
 * Bitquery account at all: the key lives server-side, exactly as the brain's
 * does, and the same claimed token opens both.
 *
 * The gateway does NOT proxy GraphQL. It answers a fixed catalogue of named
 * queries and builds the GraphQL itself, because query cost is the thing being
 * billed and an open GraphQL proxy is a blank cheque written against whoever
 * runs it. So this client sends `{query: "<name>", variables}` when it's talking
 * to the gateway, and real GraphQL only when it's using the owner's own key.
 */
export const WARDEN_GATEWAY_BITQUERY = `${WARDEN_GATEWAY_ORIGIN}/bitquery`;

export interface BitqueryCreds {
  apiKey: string;
  /** Override for self-hosted/enterprise endpoints, or if Bitquery moves it. */
  endpoint?: string;
  /**
   * True when `apiKey` is a Merry Circle gateway token rather than a Bitquery
   * key. Changes the protocol: named queries out, no raw GraphQL, and the
   * gateway's own rate limits apply.
   */
  viaGateway?: boolean;
}

/**
 * Which credentials should this agent use?
 *
 * The owner's own Bitquery key always wins — it's their quota, their limits, and
 * no third party in the path. The holder gateway is the fallback perk, and when
 * neither exists the honest answer is "no discovery", not a broken client.
 */
export function resolveBitquery(cfg: {
  bitqueryApiKey?: string;
  gatewayToken?: string;
  gatewayUrl?: string;
}): BitqueryCreds | null {
  if (cfg.bitqueryApiKey) return { apiKey: cfg.bitqueryApiKey };
  if (cfg.gatewayToken) {
    return {
      apiKey: cfg.gatewayToken,
      endpoint: cfg.gatewayUrl || WARDEN_GATEWAY_BITQUERY,
      viaGateway: true,
    };
  }
  return null;
}

export interface BitqueryResult<T> {
  ok: boolean;
  data?: T;
  /** Human-readable reason, safe to show an owner. Never contains the key. */
  error?: string;
}

/**
 * One bounded GraphQL call.
 *
 * Errors are RETURNED, not thrown: this runs alongside a trading loop, and an
 * outage in a data provider must not be able to stop the agent from selling.
 */
export async function bitqueryQuery<T = unknown>(
  creds: BitqueryCreds,
  /** Raw GraphQL for a direct key; the NAME of a catalogue query via the gateway. */
  query: string,
  variables: Record<string, unknown> = {},
  opts: { timeoutMs?: number } = {},
): Promise<BitqueryResult<T>> {
  const endpoint = creds.endpoint || BITQUERY_DEFAULT_ENDPOINT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // V2 takes a bearer token; V1 took X-API-KEY. Sending both is harmless
        // and means a key from either console works without the owner having to
        // know which generation of the API they signed up for.
        Authorization: `Bearer ${creds.apiKey}`,
        "X-API-KEY": creds.apiKey,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Deliberately not echoing the body — an auth error can quote the request.
      const hint =
        res.status === 401 || res.status === 403
          ? creds.viaGateway
            ? " — your Merry Circle token expired or your wallet no longer qualifies; re-claim it"
            : " — check the API key in /settings"
          : res.status === 429 && creds.viaGateway
            ? " — the shared holder quota is per-wallet; add your own Bitquery key in /settings to lift it"
            : "";
      return { ok: false, error: `bitquery HTTP ${res.status}${hint}` };
    }
    const json = (await res.json()) as { data?: T; errors?: { message?: string }[] };
    if (json.errors?.length) {
      return { ok: false, error: `bitquery: ${json.errors.map((e) => e.message ?? "?").join("; ").slice(0, 300)}` };
    }
    if (!json.data) return { ok: false, error: "bitquery returned no data" };
    return { ok: true, data: json.data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("abort") ? "bitquery timed out" : `bitquery unreachable: ${msg.slice(0, 200)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cheapest possible round-trip: is the key valid and is this chain indexed?
 *
 * Exists so an owner can find out their key is wrong from `merrymen doctor`,
 * rather than from a discovery feed that is quietly always empty.
 */
export async function bitqueryPing(creds: BitqueryCreds): Promise<BitqueryResult<{ blockHeight: number }>> {
  const q = creds.viaGateway
    ? "ping"
    : `{
    EVM(network: ${BITQUERY_NETWORK}) {
      Blocks(limit: {count: 1}, orderBy: {descending: Block_Number}) {
        Block { Number }
      }
    }
  }`;
  const r = await bitqueryQuery<{ EVM?: { Blocks?: { Block?: { Number?: string | number } }[] } }>(creds, q);
  if (!r.ok) return { ok: false, error: r.error };
  const raw = r.data?.EVM?.Blocks?.[0]?.Block?.Number;
  const blockHeight = Number(raw);
  if (!Number.isFinite(blockHeight) || blockHeight <= 0) {
    return { ok: false, error: "bitquery answered but returned no Robinhood Chain blocks" };
  }
  return { ok: true, data: { blockHeight } };
}

export interface NewPair {
  /** The non-cash token in the pair, lowercased. */
  token: `0x${string}`;
  symbol: string;
  decimals: number;
  /** What it pairs against (USDG or WETH), lowercased. */
  quote: `0x${string}`;
  /** Uniswap protocol the pool belongs to, as Bitquery reports it. */
  protocol: string;
  /** Unix seconds the pool was initialized. */
  createdAt: number;
  txHash: string;
}

/**
 * Pools initialized in the last `sinceMinutes`.
 *
 * `Initialize` is emitted by v3 factories and by the v4 PoolManager alike, which
 * is why this is the one query that sees a graduating token at all: a v4 pool
 * has no address of its own to watch.
 *
 * Returns candidates, not recommendations. Everything downstream still has to
 * decide whether a pool minutes old can be priced at all — and by the standards
 * merrymen already applies, usually it cannot: a fresh pool has no TWAP history
 * and almost no depth, which is exactly the shape the guards refuse.
 */
export async function recentPools(
  creds: BitqueryCreds,
  opts: { sinceMinutes?: number; limit?: number } = {},
): Promise<BitqueryResult<NewPair[]>> {
  const limit = Math.min(opts.limit ?? 25, 100);
  const sinceMinutes = opts.sinceMinutes ?? 60;
  if (creds.viaGateway) {
    // The gateway owns the GraphQL and clamps these itself; we send intent only.
    const g = await bitqueryQuery<{ EVM?: { Events?: unknown[] } }>(creds, "recentPools", {
      sinceMinutes,
      limit,
    });
    if (!g.ok) return { ok: false, error: g.error };
    return { ok: true, data: (g.data?.EVM?.Events ?? []).map(parsePoolEvent).filter((p): p is NewPair => p !== null) };
  }
  const q = `query ($since: DateTime, $limit: Int) {
    EVM(network: ${BITQUERY_NETWORK}) {
      Events(
        limit: {count: $limit}
        orderBy: {descending: Block_Time}
        where: {Log: {Signature: {Name: {is: "Initialize"}}}, Block: {Time: {after: $since}}}
      ) {
        Block { Time }
        Transaction { Hash }
        Log { Signature { Name } }
        Arguments { Name Value { ... on EVM_ABI_Address_Value_Arg { address } } }
      }
    }
  }`;
  const since = new Date(Date.now() - sinceMinutes * 60_000).toISOString();
  const r = await bitqueryQuery<{ EVM?: { Events?: unknown[] } }>(creds, q, { since, limit });
  if (!r.ok) return { ok: false, error: r.error };
  // Shape-parse defensively: this is third-party JSON reaching a trading agent,
  // and a schema change must degrade to "nothing found", not to a crash.
  const out: NewPair[] = [];
  for (const ev of r.data?.EVM?.Events ?? []) {
    const parsed = parsePoolEvent(ev);
    if (parsed) out.push(parsed);
  }
  return { ok: true, data: out };
}

/** Pure, exported for tests: third-party JSON → a NewPair, or null. */
export function parsePoolEvent(ev: unknown): NewPair | null {
  if (!ev || typeof ev !== "object") return null;
  const e = ev as {
    Block?: { Time?: string };
    Transaction?: { Hash?: string };
    Arguments?: { Name?: string; Value?: { address?: string } }[];
  };
  const addrs: string[] = [];
  for (const a of e.Arguments ?? []) {
    const v = a?.Value?.address;
    if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) addrs.push(v.toLowerCase());
  }
  if (addrs.length < 2) return null;
  const time = e.Block?.Time ? Math.floor(new Date(e.Block.Time).getTime() / 1000) : 0;
  if (!Number.isFinite(time) || time <= 0) return null;
  const hash = typeof e.Transaction?.Hash === "string" ? e.Transaction.Hash : "";
  return {
    token: addrs[0] as `0x${string}`,
    symbol: "",
    decimals: 18,
    quote: addrs[1] as `0x${string}`,
    protocol: "uniswap",
    createdAt: time,
    txHash: hash,
  };
}
