import * as SecureStore from "expo-secure-store";
import type { StoredGrant } from "@warden/core";

/**
 * Where the signed grant lives on the phone.
 *
 * SecureStore rather than AsyncStorage, because the grant carries
 * demoSessionPrivateKey — the key the worker signs trades with. It is capped and
 * expiring, so it is not the catastrophe an owner key would be, but it can still
 * spend up to the caps until it dies. That belongs in the keychain, not in a plain
 * file any process with disk access can read.
 *
 * Kept separate from keystore.ts on purpose: that file guards the OWNER key, whose
 * loss is permanent and unrecoverable. This one holds something replaceable — if
 * it goes missing the owner simply signs a new wall. Mixing them would invite
 * treating the two as equally serious, and they are not.
 */

const GRANT_KEY = "warden.grant.v1";

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function saveGrant(grant: Omit<StoredGrant, "demoOwnerPrivateKey">): Promise<void> {
  await SecureStore.setItemAsync(GRANT_KEY, JSON.stringify(grant), OPTS);
}

export async function readGrant(): Promise<Omit<StoredGrant, "demoOwnerPrivateKey"> | null> {
  const raw = await SecureStore.getItemAsync(GRANT_KEY, OPTS).catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Omit<StoredGrant, "demoOwnerPrivateKey">;
    // A grant without these is not usable, and a half-written one should read as
    // absent rather than crash the screen that depends on it.
    return parsed?.serialized && parsed?.smartAccount ? parsed : null;
  } catch {
    return null;
  }
}

export async function clearGrant(): Promise<void> {
  await SecureStore.deleteItemAsync(GRANT_KEY, OPTS).catch(() => {});
}

/** Seconds until this grant's key dies. Negative once it already has. */
export function secondsLeft(grant: { expiresAt: number }): number {
  return grant.expiresAt - Math.floor(Date.now() / 1000);
}
