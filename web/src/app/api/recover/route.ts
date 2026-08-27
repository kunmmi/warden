/**
 * Recover funds — the dashboard's "get my money out" endpoint.
 *
 * The funded address is a counterfactual ERC-4337 smart account; its owner key
 * controls it but derives a DIFFERENT address, and after a kill the session key
 * is gone. This rebuilds the account from the OWNER key (sudo) and sweeps every
 * balance to an address the user controls — the same engine `warden recover`
 * runs on the CLI (worker/src/recover.ts), reused here so there's one code path.
 *
 * Key handling: for an active grant the owner key is read from ~/.warden/
 * grant.json and NEVER leaves the server. For a killed/expired agent (no grant
 * file) the user pastes their backed-up key; it reaches only this localhost
 * route, is used to sign one op, and is never logged or echoed back. The bundler
 * key stays server-side in both cases. The dashboard binds to 127.0.0.1 BY
 * DEFAULT — but WARDEN_HOST=0.0.0.0 is a documented, supported opt-in (for
 * phone/LAN access), and there is no login system at all. Network reachability
 * alone must never be enough to authorize a fund-moving sweep.
 *
 * SWEEP CONFIRMATION (stored-key path only): a sweep that relies on the
 * server-held key — the one-click "active grant, same device" case — requires
 * a one-time 6-digit code printed to THIS PROCESS'S OWN STDOUT (see
 * `printSweepCode` below), not served over HTTP by any route. A LAN attacker
 * who can only reach port 3100 can never see that code, so they cannot
 * authorize a stored-key sweep no matter what they POST here — closing the
 * "anyone on the LAN can drain the account with one unauthenticated request"
 * hole. A PASTED key (the killed/expired flow) already proves possession of
 * the actual owner key and skips this — there's nothing left to confirm.
 *
 *   GET             → recovery context for the active grant (balances, bundler?)
 *   POST {mode:plan}→ rebuild from a key (stored or pasted) and read balances
 *   POST {mode:sweep, to} → stored-key path: prints a confirm code and returns
 *                           confirmRequired:true on the first call; resubmit
 *                           with {mode:sweep, to, confirmCode} to actually send.
 *                           Pasted-key path: signs and sends immediately.
 */

import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { homePaths } from "@/lib/home";
import {
  chainForId,
  explorerFor,
  pimlicoBundlerUrl,
  bscChain,
  type WardenSettings,
  type StoredGrant,
} from "@warden/core";
import { planRecovery, recoverFunds } from "@warden/recover";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isKey = (v: unknown): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
const isAddr = (v: unknown): v is `0x${string}` => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const SWEEP_CODE_TTL_MS = 2 * 60 * 1000;

/**
 * Module-level, single-slot — this app is single-tenant (one grant, one
 * account) by design, so there's never more than one sweep in flight. Lives
 * only in process memory; a restart clears any pending code, which is the
 * safe default (better to re-confirm than to honor a stale one).
 */
let pendingSweep: { code: string; to: string; chainId: number; expiresAt: number } | null = null;

/** Never served over HTTP — this is the whole point. Visible only to whoever
 * can read this process's own terminal, i.e. someone physically at the machine
 * (or with a real shell on it), which a LAN-only attacker is not. */
function printSweepCode(code: string, to: string): void {
  console.log(
    `\n➳ RECOVERY CONFIRMATION NEEDED\n  Someone requested a fund sweep to ${to}.\n  If that's you, enter this code in the dashboard: ${code}\n  (expires in 2 minutes — if you didn't request this, ignore it and consider rotating your owner key)\n`,
  );
}

async function readGrant(): Promise<StoredGrant | null> {
  try {
    return JSON.parse(await readFile(homePaths.grant(), "utf8")) as StoredGrant;
  } catch {
    return null;
  }
}

async function readSettings(): Promise<WardenSettings> {
  try {
    return JSON.parse((await readFile(homePaths.settings(), "utf8")).replace(/^﻿/, "")) as WardenSettings;
  } catch {
    return {};
  }
}

/** The effective bundler URL: explicit URL wins, else build Pimlico's from the key. */
function bundlerFor(settings: WardenSettings, chainId: number): string | undefined {
  if (settings.bundlerUrl) return settings.bundlerUrl;
  if (settings.bundlerApiKey) return pimlicoBundlerUrl(chainId, settings.bundlerApiKey);
  if (process.env.WARDEN_BUNDLER_URL) return process.env.WARDEN_BUNDLER_URL;
  if (process.env.WARDEN_BUNDLER_API_KEY) return pimlicoBundlerUrl(chainId, process.env.WARDEN_BUNDLER_API_KEY);
  return undefined;
}

function rpcFor(settings: WardenSettings, chainId: number): string | undefined {
  return chainId === bscChain.id ? settings.rpcMainnet : settings.rpcTestnet;
}

/** Context for the active grant so the panel can render without asking for a key. */
export async function GET() {
  const [grant, settings] = await Promise.all([readGrant(), readSettings()]);

  if (!grant || !isKey(grant.demoOwnerPrivateKey)) {
    // Killed/expired (or externally-owned) — no stored key. The UI asks for the
    // backed-up owner key. hasBundler is a best-effort mainnet guess for the hint.
    return NextResponse.json({ hasStoredKey: false, hasBundler: !!bundlerFor(settings, bscChain.id) });
  }

  const chainId = grant.chainId;
  const hasBundler = !!bundlerFor(settings, chainId);
  try {
    const plan = await planRecovery({
      chain: chainForId(chainId),
      ownerPrivateKey: grant.demoOwnerPrivateKey,
      rpcUrl: rpcFor(settings, chainId),
      expectedSmartAccount: grant.smartAccount,
    });
    return NextResponse.json({
      hasStoredKey: true,
      hasBundler,
      chainId,
      explorer: explorerFor(chainId),
      smartAccount: plan.smartAccount,
      ownerAddress: plan.ownerAddress,
      gasWei: plan.gasWei.toString(),
      balances: plan.balances.map((b) => ({ symbol: b.symbol, amount: b.amount })),
    });
  } catch (e) {
    return NextResponse.json({ hasStoredKey: true, hasBundler, chainId, error: msg(e) });
  }
}

export async function POST(req: Request) {
  let body: { mode?: string; to?: unknown; ownerKey?: unknown; chainId?: unknown; confirmCode?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "body is not JSON" }, { status: 400 });
  }

  const [grant, settings] = await Promise.all([readGrant(), readSettings()]);
  const mode = body.mode === "sweep" ? "sweep" : "plan";

  // Prefer a pasted key (killed case); fall back to the active grant's stored key.
  const pasted = isKey(body.ownerKey);
  const ownerKey = pasted ? (body.ownerKey as `0x${string}`) : isKey(grant?.demoOwnerPrivateKey) ? grant!.demoOwnerPrivateKey! : undefined;
  if (!ownerKey) {
    return NextResponse.json({ error: "no owner key — paste the owner key you backed up" }, { status: 400 });
  }

  const chainId = Number.isInteger(body.chainId) ? Number(body.chainId) : grant?.chainId ?? bscChain.id;
  // Only assert an expected account when signing with the grant's OWN stored key
  // (we know which account that is); a pasted key may be for a different wallet.
  const expected = pasted ? undefined : grant?.smartAccount;
  const rpcUrl = rpcFor(settings, chainId);

  // A PASTED key already proves possession of the real owner key — that's the
  // whole trust boundary for the killed/expired flow, nothing left to gate.
  // The STORED key is different: reachability of this HTTP endpoint is the
  // ONLY thing a caller has proven so far, and (per WARDEN_HOST=0.0.0.0)
  // reachability can mean "anyone on the LAN," not "the account's owner." So a
  // stored-key sweep additionally requires a fresh code from this process's
  // own terminal — see the file-level comment for why that's a real boundary
  // and not just security theater.
  if (mode === "sweep" && !pasted) {
    if (!isAddr(body.to)) {
      return NextResponse.json({ error: "destination is not a valid address" }, { status: 400 });
    }
    const now = Date.now();
    const submitted = typeof body.confirmCode === "string" ? body.confirmCode.trim() : "";
    const validPending =
      pendingSweep &&
      pendingSweep.to === body.to &&
      pendingSweep.chainId === chainId &&
      pendingSweep.expiresAt > now &&
      submitted.length > 0 &&
      submitted === pendingSweep.code;

    if (!validPending) {
      // Wrong/missing/expired/mismatched-target code: mint a fresh one bound to
      // THIS (to, chainId) pair and require it before proceeding. Never say
      // "wrong code" vs "no code" differently — both cases print a new one.
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      pendingSweep = { code, to: body.to, chainId, expiresAt: now + SWEEP_CODE_TTL_MS };
      printSweepCode(code, body.to);
      return NextResponse.json(
        { confirmRequired: true, error: "check the terminal running warden start for a 6-digit code, then confirm" },
        { status: 401 },
      );
    }
    // Consumed — single use, so a leaked/observed code can't be replayed.
    pendingSweep = null;
  }

  try {
    if (mode === "plan") {
      const plan = await planRecovery({
        chain: chainForId(chainId),
        ownerPrivateKey: ownerKey,
        rpcUrl,
        expectedSmartAccount: expected,
      });
      return NextResponse.json({
        smartAccount: plan.smartAccount,
        ownerAddress: plan.ownerAddress,
        gasWei: plan.gasWei.toString(),
        explorer: explorerFor(chainId),
        chainId,
        balances: plan.balances.map((b) => ({ symbol: b.symbol, amount: b.amount })),
      });
    }

    // sweep
    if (!isAddr(body.to)) {
      return NextResponse.json({ error: "destination is not a valid address" }, { status: 400 });
    }
    const bundlerUrl = bundlerFor(settings, chainId);
    if (!bundlerUrl) {
      return NextResponse.json(
        { error: "recovery needs a bundler — add a free Pimlico key in Settings, then try again" },
        { status: 400 },
      );
    }
    const res = await recoverFunds({
      chain: chainForId(chainId),
      ownerPrivateKey: ownerKey,
      bundlerUrl,
      rpcUrl,
      to: body.to,
      expectedSmartAccount: expected,
    });
    return NextResponse.json({
      txHash: res.txHash,
      to: res.to,
      smartAccount: res.smartAccount,
      explorer: explorerFor(chainId),
      chainId,
      balances: res.balances.map((b) => ({ symbol: b.symbol, amount: b.amount })),
    });
  } catch (e) {
    return NextResponse.json({ error: msg(e) }, { status: 500 });
  }
}
