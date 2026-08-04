/**
 * Auto-start — surviving a logout, a sleep, and a reboot.
 *
 * merrymen is self-hosted and non-custodial, which means it runs on the owner's
 * machine and stops when that machine stops. Nothing here changes that. What it
 * changes is the far more common failure: an agent that was running fine until
 * the owner closed a terminal, logged out, or rebooted, and then silently wasn't.
 *
 * THE LIMIT, SAID PLAINLY EVERYWHERE THIS APPEARS: this survives logout, sleep
 * and reboot. It does NOT make the agent run while the computer is off. The only
 * honest fix for that is a machine that stays on — the owner's own always-on box,
 * not us holding their keys.
 *
 * THREE RULES THIS FILE FOLLOWS, because it writes real OS state:
 *
 *  1. USER SCOPE ONLY. No admin, no sudo, no system-wide daemon. Everything
 *     installed here lives under the current user and dies with their account.
 *     A trading agent has no business asking for root.
 *
 *  2. EVERY INSTALL HAS AN UNINSTALL. Anything written is named predictably and
 *     removed completely by `uninstall`. Leaving orphaned scheduled tasks on
 *     someone's machine after they've uninstalled the package would be
 *     unforgivable for a program that holds keys.
 *
 *  3. NOTHING IS HIDDEN. `status` reports exactly what exists and where, so the
 *     owner can inspect or delete it by hand without this tool's help.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "bin.mjs");

/** One stable identifier, so install/status/uninstall always agree. */
export const SERVICE_ID = "merrymen";
const WIN_TASK = "merrymen";
const MAC_LABEL = "dev.warden.agent";
const LINUX_UNIT = "merrymen.service";

/**
 * Run a command, capture output, never throw.
 *
 * Deliberately NO `shell: true`. schtasks/launchctl/systemctl are real
 * executables, and a shell would re-parse the arguments — which on Windows
 * breaks the moment a path contains a space. Both of the paths this file cares
 * about routinely do ("C:\\Program Files\\nodejs", and any project folder with
 * a space in its name), and the failure is a confusing schtasks parse error
 * rather than anything that names the real cause.
 */
function run(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8" });
    return { status: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
  } catch (e) {
    return { status: 1, out: e instanceof Error ? e.message : String(e) };
  }
}

const macPlist = () => path.join(os.homedir(), "Library", "LaunchAgents", `${MAC_LABEL}.plist`);
const linuxUnit = () =>
  path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "systemd", "user", LINUX_UNIT);

/**
 * Where this service's own log goes. A background process with nowhere to write
 * is a process whose failures are invisible — the owner needs somewhere to look
 * when the agent "just didn't run".
 */
export function logPath() {
  const home = process.env.WARDEN_HOME ?? path.join(os.homedir(), ".warden");
  return path.join(home, "service.log");
}

// ── install ─────────────────────────────────────────────────────────────────

/** Where the Windows launcher lives. Named so it's obvious what wrote it. */
function winLauncher() {
  const home = process.env.WARDEN_HOME ?? path.join(os.homedir(), ".warden");
  return path.join(home, "merrymen-service.cmd");
}

/** The per-user Startup folder — runs at logon with no privileges at all. */
function winStartupEntry() {
  const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "merrymen.cmd");
}

function installWindows() {
  // A LAUNCHER SCRIPT, not a command line. Command-line quoting fights with
  // Windows argument escaping, and both the node path ("C:\Program Files\...")
  // and the install path routinely contain spaces. A single .cmd taking no
  // arguments sidesteps that whole class of bug — and gives us somewhere to
  // redirect output, which neither Task Scheduler nor the Startup folder
  // preserves on its own.
  const launcher = winLauncher();
  const log = logPath();
  mkdirSync(path.dirname(launcher), { recursive: true });
  writeFileSync(
    launcher,
    `@echo off\r\n` +
      `rem Written by "merrymen service install". Safe to delete once uninstalled.\r\n` +
      `start "" /b "${process.execPath}" "${CLI}" start >> "${log}" 2>&1\r\n`,
    "utf8",
  );

  // PREFER Task Scheduler: it can restart the agent and survives more than a
  // Startup entry does. But `/sc onlogon` needs elevation on a default Windows
  // install, and a trading agent has no business demanding admin. So try it,
  // and fall back to the per-user Startup folder — which always works, needs
  // nothing, and is what "start when I log in" means to a person.
  const task = run("schtasks", ["/create", "/tn", WIN_TASK, "/tr", launcher, "/sc", "onlogon", "/f"]);
  if (task.status === 0) {
    return { ok: true, detail: `Task Scheduler task "${WIN_TASK}" (at logon)` };
  }

  try {
    const entry = winStartupEntry();
    mkdirSync(path.dirname(entry), { recursive: true });
    writeFileSync(entry, `@echo off\r\ncall "${launcher}"\r\n`, "utf8");
    return {
      ok: true,
      detail: `Startup folder entry at ${entry}` +
        ` (Task Scheduler needed admin, so this used the no-privileges route instead)`,
    };
  } catch (e) {
    rmSync(launcher, { force: true }); // leave nothing behind on a failed install
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

function installMac() {
  const plist = macPlist();
  mkdirSync(path.dirname(plist), { recursive: true });
  const log = logPath();
  writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${CLI}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`,
    "utf8",
  );
  // bootstrap is the modern verb; load is the fallback on older macOS.
  const uid = process.getuid?.() ?? 0;
  let r = run("launchctl", ["bootstrap", `gui/${uid}`, plist]);
  if (r.status !== 0) r = run("launchctl", ["load", "-w", plist]);
  if (r.status !== 0) return { ok: false, detail: r.out || "launchctl refused" };
  return { ok: true, detail: `launchd agent at ${plist}` };
}

function installLinux() {
  const unit = linuxUnit();
  mkdirSync(path.dirname(unit), { recursive: true });
  writeFileSync(
    unit,
    `[Unit]
Description=merrymen — autonomous trading agent
After=network-online.target

[Service]
Type=simple
ExecStart=${process.execPath} ${CLI} start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`,
    "utf8",
  );
  run("systemctl", ["--user", "daemon-reload"]);
  const r = run("systemctl", ["--user", "enable", "--now", LINUX_UNIT]);
  if (r.status !== 0) return { ok: false, detail: r.out || "systemctl refused" };
  // Without lingering, a user unit is killed the moment the owner logs out —
  // which would defeat the entire point. Best-effort: it needs polkit on some
  // systems, so a failure is reported rather than treated as fatal.
  const linger = run("loginctl", ["enable-linger", os.userInfo().username]);
  const note = linger.status === 0 ? "" : " (couldn't enable lingering — run `loginctl enable-linger $USER` to survive logout)";
  return { ok: true, detail: `systemd --user unit ${LINUX_UNIT}${note}` };
}

export function installService() {
  if (process.platform === "win32") return installWindows();
  if (process.platform === "darwin") return installMac();
  if (process.platform === "linux") return installLinux();
  return { ok: false, detail: `auto-start isn't wired for ${process.platform} yet` };
}

// ── uninstall ───────────────────────────────────────────────────────────────

export function uninstallService() {
  if (process.platform === "win32") {
    // BOTH mechanisms, because install may have used either. Removing the
    // launcher and the Startup entry regardless is the point: a stale .cmd left
    // in someone's home or Startup folder after an uninstall is exactly the
    // litter this file promised not to leave.
    const task = run("schtasks", ["/delete", "/tn", WIN_TASK, "/f"]);
    const entry = winStartupEntry();
    const hadEntry = existsSync(entry);
    rmSync(entry, { force: true });
    rmSync(winLauncher(), { force: true });
    const removed = [
      task.status === 0 ? `task "${WIN_TASK}"` : null,
      hadEntry ? "Startup entry" : null,
    ].filter(Boolean);
    if (!removed.length) return { ok: false, detail: "nothing was installed" };
    return { ok: true, detail: `removed ${removed.join(" + ")} and the launcher` };
  }
  if (process.platform === "darwin") {
    const plist = macPlist();
    const uid = process.getuid?.() ?? 0;
    run("launchctl", ["bootout", `gui/${uid}/${MAC_LABEL}`]);
    run("launchctl", ["unload", "-w", plist]);
    // Remove the file too — an unloaded plist left on disk reloads at next login.
    if (existsSync(plist)) rmSync(plist, { force: true });
    return { ok: true, detail: `removed ${plist}` };
  }
  if (process.platform === "linux") {
    const unit = linuxUnit();
    run("systemctl", ["--user", "disable", "--now", LINUX_UNIT]);
    if (existsSync(unit)) rmSync(unit, { force: true });
    run("systemctl", ["--user", "daemon-reload"]);
    return { ok: true, detail: `removed ${unit}` };
  }
  return { ok: false, detail: `auto-start isn't wired for ${process.platform}` };
}

// ── status ──────────────────────────────────────────────────────────────────

/**
 * Installed AND running are different questions, and conflating them is how an
 * owner ends up believing their agent is trading when it crashed hours ago.
 */
export function serviceStatus() {
  if (process.platform === "win32") {
    const q = run("schtasks", ["/query", "/tn", WIN_TASK, "/fo", "list", "/v"]);
    if (q.status === 0) {
      return {
        installed: true,
        running: /Status:\s*Running/i.test(q.out),
        where: `Task Scheduler → ${WIN_TASK}`,
      };
    }
    // Fall back to the Startup entry — what install uses when Task Scheduler
    // wanted admin. Checking only the task would tell an owner auto-start
    // isn't installed when it demonstrably is.
    const entry = winStartupEntry();
    if (existsSync(entry)) return { installed: true, running: false, where: entry };
    return { installed: false, running: false, where: null };
  }
  if (process.platform === "darwin") {
    const plist = macPlist();
    if (!existsSync(plist)) return { installed: false, running: false, where: null };
    const uid = process.getuid?.() ?? 0;
    const q = run("launchctl", ["print", `gui/${uid}/${MAC_LABEL}`]);
    return { installed: true, running: q.status === 0 && /state\s*=\s*running/i.test(q.out), where: plist };
  }
  if (process.platform === "linux") {
    const unit = linuxUnit();
    if (!existsSync(unit)) return { installed: false, running: false, where: null };
    const q = run("systemctl", ["--user", "is-active", LINUX_UNIT]);
    return { installed: true, running: q.out.trim() === "active", where: unit };
  }
  return { installed: false, running: false, where: null };
}

/** Last few lines of the service log — where a silent failure actually shows. */
export function serviceLogTail(lines = 12) {
  try {
    return readFileSync(logPath(), "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return null;
  }
}
