import assert from "node:assert/strict";
import test from "node:test";
import { McpClient, McpError, isMutatingTool, parseFrame } from "../../packages/core/src/mcp";

/**
 * The MCP client, tested where it can silently be wrong: the framing parser
 * (a server may answer the same request as JSON or as SSE, and only one of
 * those shows up in casual testing) and the mutating-tool gate.
 *
 * The PKCE/OAuth test block that used to live below this was Robinhood-OAuth-
 * specific (packages/core/src/robinhood-oauth.ts, deleted in the BSC fork —
 * no equivalent flow exists yet). Removed rather than ported: v0 has no
 * wallet/auth path at all (see docs/PROGRESS.md), so there is nothing for an
 * OAuth test to exercise. Re-add when v1 defines whatever BSC's auth story is.
 */

// ── framing ────────────────────────────────────────────────────────────────

test("parseFrame passes plain JSON through untouched", () => {
  const body = '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}';
  assert.equal(parseFrame(body, "application/json"), body);
});

test("parseFrame concatenates the data: lines of a one-shot SSE response", () => {
  // The trap: the same server answers either way, so a naive res.json() works
  // in testing and throws the first time production streams.
  const sse = ["event: message", 'data: {"jsonrpc":"2.0","id":1,', 'data: "result":{"ok":true}}', ""].join("\r\n");
  assert.equal(parseFrame(sse, "text/event-stream"), '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
});

test("parseFrame tolerates CRLF and bare LF, and charset on the content-type", () => {
  const payload = '{"a":1}';
  for (const nl of ["\r\n", "\n"]) {
    assert.equal(parseFrame(`data: ${payload}${nl}`, "text/event-stream; charset=utf-8"), payload);
  }
});

test("parseFrame throws on an event-stream carrying no data lines", () => {
  // Returning "" would surface later as an inscrutable JSON.parse failure.
  assert.throws(() => parseFrame("event: ping\r\n\r\n", "text/event-stream"), McpError);
});

// ── the gate ───────────────────────────────────────────────────────────────

test("isMutatingTool recognises the documented and the not-yet-shipped mutators", () => {
  for (const n of [
    "place_equity_order",
    "place_crypto_order", // ships when Robinhood adds crypto
    "place_options_order",
    "cancel_equity_order",
    "transfer_funds",
    "withdraw_funds",
    "sell_position",
    "execute_trade",
  ]) {
    assert.equal(isMutatingTool(n), true, `${n} must be treated as mutating`);
  }
});

test("isMutatingTool leaves reads — and review — callable", () => {
  // review_equity_order is the DRY RUN half of the propose/dispose pair. If it
  // were refused, there would be no way to price an order before deciding.
  for (const n of [
    "get_accounts",
    "get_portfolio",
    "get_equity_positions",
    "get_equity_quotes",
    "get_equity_orders",
    "search",
    "review_equity_order",
  ]) {
    assert.equal(isMutatingTool(n), false, `${n} must stay callable`);
  }
});

/** A fetch that records calls and replays canned responses. */
function stubFetch(reply: { status?: number; body: string; contentType?: string; headers?: Record<string, string> }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    const h = new Headers({ "content-type": reply.contentType ?? "application/json", ...(reply.headers ?? {}) });
    return new Response(reply.body, { status: reply.status ?? 200, headers: h });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("callTool REFUSES a mutating tool by default, and never reaches the network", async () => {
  const { impl, calls } = stubFetch({ body: "{}" });
  const c = new McpClient({ url: "https://x/mcp", token: "t", fetchImpl: impl });
  await assert.rejects(() => c.callTool("place_equity_order", { symbol: "AAPL" }), /explicit opt-in/);
  // The refusal must happen before any request — a guard that fires after the
  // order is already on the wire is not a guard.
  assert.equal(calls.length, 0);
});

test("callTool allows a mutating tool only when its exact name is opted in", async () => {
  const { impl, calls } = stubFetch({ body: '{"jsonrpc":"2.0","id":1,"result":{"placed":true}}' });
  const c = new McpClient({
    url: "https://x/mcp",
    token: "t",
    fetchImpl: impl,
    allowMutating: ["place_equity_order"],
  });
  await c.callTool("place_equity_order", {});
  assert.equal(calls.length, 1);
  // Opting one in must not open the others.
  await assert.rejects(() => c.callTool("cancel_equity_order", {}), /explicit opt-in/);
  assert.equal(calls.length, 1);
});

test("callTool passes read tools straight through", async () => {
  const { impl, calls } = stubFetch({ body: '{"jsonrpc":"2.0","id":1,"result":{"accounts":[]}}' });
  const c = new McpClient({ url: "https://x/mcp", token: "t", fetchImpl: impl });
  await c.callTool("get_accounts");
  assert.equal(calls.length, 1);
  const body = JSON.parse(String(calls[0]!.init.body));
  assert.equal(body.method, "tools/call");
  assert.equal(body.params.name, "get_accounts");
});

// ── transport details ──────────────────────────────────────────────────────

test("the bearer and protocol version go on every request; session id is captured and echoed", async () => {
  const { impl, calls } = stubFetch({
    body: '{"jsonrpc":"2.0","id":1,"result":{}}',
    headers: { "mcp-session-id": "sess-42" },
  });
  const c = new McpClient({ url: "https://x/mcp", token: "secret-token", fetchImpl: impl });
  await c.callTool("get_accounts");
  const h1 = new Headers(calls[0]!.init.headers as HeadersInit);
  assert.equal(h1.get("Authorization"), "Bearer secret-token");
  assert.equal(h1.get("MCP-Protocol-Version"), "2025-06-18");
  assert.equal(h1.get("Mcp-Session-Id"), null, "no session on the first call");

  await c.callTool("get_portfolio");
  const h2 = new Headers(calls[1]!.init.headers as HeadersInit);
  assert.equal(h2.get("Mcp-Session-Id"), "sess-42", "session captured from the first response");
});

test("a JSON-RPC error becomes McpError, and an HTTP error does not echo the body", async () => {
  const bad = stubFetch({ body: '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"nope"}}' });
  const c1 = new McpClient({ url: "https://x/mcp", token: "t", fetchImpl: bad.impl });
  await assert.rejects(() => c1.callTool("get_accounts"), /nope/);

  const denied = stubFetch({ status: 401, body: "token=abc123 leaked in an error body" });
  const c2 = new McpClient({ url: "https://x/mcp", token: "t", fetchImpl: denied.impl });
  await assert.rejects(
    () => c2.callTool("get_accounts"),
    (e: Error) => e.message.includes("401") && !e.message.includes("abc123"),
  );
});
