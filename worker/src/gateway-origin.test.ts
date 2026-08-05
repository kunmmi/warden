/**
 * The gateway origin is written down in three places, and they must agree.
 *
 * There is no shared import that could enforce this. The website is a standalone
 * Next app that doesn't compile the TS core, and cli/bin.mjs is plain ESM that
 * can't import TypeScript at all — a constraint its own comments already note
 * about the provider list. So the value is mirrored by hand:
 *
 *   packages/core/src/gateway.ts   WARDEN_GATEWAY_ORIGIN  (the worker/web client)
 *   site/lib/gateway.ts          GATEWAY_ORIGIN           (the memescope page)
 *   cli/bin.mjs                  the hosted-provider's `key` hint, shown
 *                                during onboarding as where to claim a key
 *
 * Three hand-copies with one pending migration between them is a half-flip
 * waiting to happen: someone moves the client to ai.warden.dev, the website
 * keeps calling Railway, and the onboarding text sends people to a third thing.
 * Each would look fine in isolation. This test is the thing that notices.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The two hosts this project is allowed to point at, and why each exists. */
const RAILWAY = "merrymen-gateway-production.up.railway.app";
const CUSTOM = "ai.warden.dev";

function read(rel: string): string | null {
  const p = path.join(ROOT, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

/** Every gateway host mentioned in a file, deduped. */
function hostsIn(src: string): string[] {
  const found = new Set<string>();
  for (const h of [RAILWAY, CUSTOM]) if (src.includes(h)) found.add(h);
  return [...found];
}

test("the client and the website point at the same gateway", () => {
  const core = read("packages/core/src/gateway.ts");
  assert.ok(core, "packages/core/src/gateway.ts must exist");

  const coreOrigin = /WARDEN_GATEWAY_ORIGIN\s*=\s*"https:\/\/([^"]+)"/.exec(core!)?.[1];
  assert.ok(coreOrigin, "WARDEN_GATEWAY_ORIGIN should be a literal https URL");
  assert.ok([RAILWAY, CUSTOM].includes(coreOrigin!), `unexpected gateway host "${coreOrigin}" — add it here deliberately`);

  // site/ is not part of the published npm package, so this half only applies
  // in the repo. Skipping is correct there; failing would be noise.
  const site = read("site/lib/gateway.ts");
  if (site) {
    const siteOrigin = /GATEWAY_ORIGIN\s*=\s*"https:\/\/([^"]+)"/.exec(site)?.[1];
    assert.ok(siteOrigin, "site GATEWAY_ORIGIN should be a literal https URL");
    assert.equal(
      siteOrigin,
      coreOrigin,
      "the website and the client disagree about the gateway — a switch landed in one and not the other",
    );
  }
});

test("onboarding sends people to the gateway the client actually calls", () => {
  const core = read("packages/core/src/gateway.ts")!;
  const coreOrigin = /WARDEN_GATEWAY_ORIGIN\s*=\s*"https:\/\/([^"]+)"/.exec(core)![1];
  const bin = read("cli/bin.mjs");
  assert.ok(bin, "cli/bin.mjs must exist");

  // The claim hint is a bare host + /claim, not a full URL, so match on the host.
  const line = bin!.split("\n").find((l) => l.includes('id: "gateway"'));
  assert.ok(line, 'the CLI should still declare an id: "gateway" provider');
  const hosts = hostsIn(line!);
  assert.deepEqual(
    hosts,
    [coreOrigin],
    `onboarding points at ${hosts.join(", ") || "nothing recognisable"} but the client calls ${coreOrigin}`,
  );
});

test("no file quietly references the other gateway host", () => {
  const core = read("packages/core/src/gateway.ts")!;
  const coreOrigin = /WARDEN_GATEWAY_ORIGIN\s*=\s*"https:\/\/([^"]+)"/.exec(core)![1];
  const other = coreOrigin === RAILWAY ? CUSTOM : RAILWAY;

  // Comments legitimately discuss the host we are NOT using — that's how the
  // pending migration is documented. Only executable references should be
  // single-valued, so strip line comments before looking.
  for (const rel of ["packages/core/src/gateway.ts", "site/lib/gateway.ts"]) {
    const src = read(rel);
    if (!src) continue;
    const code = src
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    assert.equal(
      code.includes(other),
      false,
      `${rel} has a live reference to ${other} while the client uses ${coreOrigin}`,
    );
  }
});
