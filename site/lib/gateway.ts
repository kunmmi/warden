/**
 * The merrymen gateway, as the website sees it.
 *
 * Only the PUBLIC surface is used from the browser: /memescope, which needs no
 * token and returns nothing private. Every other gateway route is holder-gated
 * and deliberately serves no `access-control-allow-origin`, so a page cannot
 * read one even if it tried — that is a security property of the gateway, not an
 * oversight, and this file must not grow a helper that works around it.
 *
 * Kept in sync by hand with WARDEN_GATEWAY_ORIGIN in packages/core/src/gateway.ts.
 * Both still point at the Railway service URL rather than ai.warden.dev while
 * that certificate is pending; when it lands, both change together.
 */
export const GATEWAY_ORIGIN = "https://merrymen-gateway-production.up.railway.app";

export interface ScopePool {
  token: string;
  quote: string;
  createdAt: number;
  txHash: string;
  symbol: string | null;
  decimals: number | null;
}

export interface ScopeResponse {
  pools: ScopePool[];
  cached?: boolean;
  stale?: boolean;
  ttl?: number;
}

export type ScopeOutcome =
  | { ok: true; data: ScopeResponse }
  | { ok: false; kind: "unconfigured" | "ratelimit" | "upstream" | "offline"; message: string };

/**
 * Fetch the scope, turning every failure into a described outcome.
 *
 * The distinctions matter to the reader: a gateway with no Bitquery key is a
 * deployment that simply hasn't enabled discovery, which is very different from
 * a provider outage, and neither should render as a generic broken page.
 */
export async function fetchScope(signal?: AbortSignal): Promise<ScopeOutcome> {
  try {
    const res = await fetch(`${GATEWAY_ORIGIN}/memescope`, { signal, cache: "no-store" });
    if (res.status === 503) {
      return { ok: false, kind: "unconfigured", message: "This gateway hasn't been given a Bitquery key, so discovery is off." };
    }
    if (res.status === 429) {
      return { ok: false, kind: "ratelimit", message: "Slow down — the scope only refreshes every 45 seconds anyway." };
    }
    if (!res.ok) {
      return { ok: false, kind: "upstream", message: "The chain indexer isn't answering right now." };
    }
    const data = (await res.json()) as ScopeResponse;
    return { ok: true, data: { ...data, pools: Array.isArray(data.pools) ? data.pools : [] } };
  } catch {
    return { ok: false, kind: "offline", message: "Couldn't reach the gateway." };
  }
}
