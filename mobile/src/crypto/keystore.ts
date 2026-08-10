import * as SecureStore from "expo-secure-store";

/**
 * Where the owner key lives, and how we tell "gone" from "never existed".
 *
 * THE FAILURE THIS GUARDS AGAINST. expo-secure-store can return null for two
 * completely different situations: nothing was ever stored, or the OS destroyed
 * the key. On Android the second happens whenever biometric enrolment changes —
 * the user adds a fingerprint in system Settings — and the module CATCHES
 * KeyPermanentlyInvalidatedException and returns null rather than throwing. The
 * two are indistinguishable from the read alone.
 *
 * A naive app reads null, concludes "first run", generates a fresh key, and
 * strands a funded smart account forever. So a second, DELIBERATELY
 * NON-AUTHENTICATED marker is written alongside. It survives what the key does not,
 * and the pair of them is what makes the distinction legible:
 *
 *   marker absent, secret absent  -> genuinely a first run
 *   marker PRESENT, secret absent -> the key was destroyed. Do NOT generate a new
 *                                    one. Send the owner to recovery.
 *   marker present, secret present-> normal
 *
 * ON requireAuthentication. It is deliberately OFF here, with a matching
 * keychainAccessible of WHEN_UNLOCKED_THIS_DEVICE_ONLY, and the biometric prompt
 * is applied at SIGNING time via expo-local-authentication instead. The trade is
 * explicit: `true` gives a real cryptographic gate but opts into the silent
 * destruction above on an action users take routinely; `false` survives
 * re-enrolment but the gate is enforced by our code rather than by the OS.
 * Because a verified mnemonic backup is mandatory before any key can be used,
 * destruction is recoverable either way — so the choice comes down to which
 * failure is more likely, and "user added a fingerprint" is far more likely than
 * "attacker has code execution inside the app". The sentinel is implemented
 * regardless, so flipping this to `true` later needs no other change.
 */

const SECRET_KEY = "warden.owner.mnemonic";
/** Never authenticated — its whole job is to outlive the secret. */
const MARKER_KEY = "warden.owner.present";

const OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export type KeyStatus =
  | { state: "empty" }
  | { state: "present"; mnemonic: string }
  /** The OS destroyed the key. Generating a new one here would strand funds. */
  | { state: "invalidated" };

export async function readOwner(): Promise<KeyStatus> {
  const marker = await SecureStore.getItemAsync(MARKER_KEY).catch(() => null);
  const secret = await SecureStore.getItemAsync(SECRET_KEY, OPTS).catch(() => null);

  if (secret) return { state: "present", mnemonic: secret };
  if (marker) return { state: "invalidated" };
  return { state: "empty" };
}

/**
 * Persist the mnemonic. The marker is written LAST, on purpose: if the process
 * dies between the two writes, the result is "empty" (a clean retry) rather than
 * "invalidated" (which would send a first-time user to a recovery screen for a
 * key they never had).
 */
export async function writeOwner(mnemonic: string): Promise<void> {
  await SecureStore.setItemAsync(SECRET_KEY, mnemonic, OPTS);
  await SecureStore.setItemAsync(MARKER_KEY, "1");
}

/**
 * Forget the key on this device.
 *
 * Clears the marker too — this is a deliberate act by the owner, not the OS
 * destroying something behind their back, so afterwards the app should look like
 * a first run rather than shouting about a lost key.
 */
export async function forgetOwner(): Promise<void> {
  await SecureStore.deleteItemAsync(SECRET_KEY, OPTS).catch(() => {});
  await SecureStore.deleteItemAsync(MARKER_KEY).catch(() => {});
}

/** Whether the device can store secrets at all — false on web and some emulators. */
export async function keystoreAvailable(): Promise<boolean> {
  return SecureStore.isAvailableAsync().catch(() => false);
}
