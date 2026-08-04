/**
 * ~/.warden — where all user data lives (settings, grant, ledger,
 * strategies). Shared convention with the worker and CLI; override with
 * WARDEN_HOME. The web app never writes anywhere else.
 */

import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function wardenHome(): string {
  const home = process.env.WARDEN_HOME ?? path.join(os.homedir(), ".warden");
  try {
    mkdirSync(home, { recursive: true });
  } catch {
    // reads on a missing dir fail gracefully downstream
  }
  return home;
}

export const homePaths = {
  settings: () => path.join(wardenHome(), "settings.json"),
  grant: () => path.join(wardenHome(), "grant.json"),
  heartbeat: () => path.join(wardenHome(), "heartbeat.json"),
  db: () => path.join(wardenHome(), "warden.db"),
  strategies: () => path.join(wardenHome(), "strategies"),
  /**
   * Every wallet this machine has ever armed, one file per smart account.
   * grant.json is a SINGLE slot — creating or killing a wallet used to blow the
   * old one away along with its owner key, stranding any funds in it forever.
   * Grants are archived here first, so a funded wallet is never lost to a click.
   */
  grantsArchive: () => path.join(wardenHome(), "grants"),
};
