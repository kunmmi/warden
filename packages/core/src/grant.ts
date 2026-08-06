/** Grant shapes shared by web (issuer) and worker (consumer). */

import {
  CASH,
  LEGACY_TRADEABLE_SYMBOLS,
  STOCK_TOKENS,
  TRADEABLE_SYMBOLS,
  type CustomToken,
} from "./tokens";

/**
 * grantFeatures marker meaning "this signature carries the WIDE tradable set".
 *
 * TRADEABLE_SYMBOLS grows as pools are seeded, but a session key signed last
 * month has last month's list sealed into its call policy. Reading the current
 * constant and assuming an old grant covers it is exactly the bug that let a
 * position be bought and never sold — so the grant declares what it carries,
 * and code that needs to know asks the grant, not the constant.
 */
export const TRADEABLE_V2 = "tradeable-v2";

export interface GrantCaps {
  perTradeUsdg: number;
  dailyUsdg: number;
  expiryDays: number;
  maxDrawdownPct: number;
  maxOpsPerDay: number;
}

export interface StoredGrant {
  smartAccount: `0x${string}`;
  owner: `0x${string}`;
  sessionKeyAddress: `0x${string}`;
  /** ZeroDev serialized permission account — everything the worker needs to act. */
  serialized: string;
  caps: GrantCaps;
  grantedAt: number;
  expiresAt: number;
  chainId: number;
  /**
   * Capabilities baked into this grant's on-chain call policy beyond the
   * original set (e.g. "transfer"). Lets the worker tell a pre-transfer grant
   * apart from a new one instead of letting the UserOp revert at the wall.
   */
  grantFeatures?: string[];
  /**
   * Owner-added token addresses (lowercase) whose approve() this grant's
   * on-chain call policy actually covers, beyond the built-in tradable set.
   *
   * Recorded so the worker can tell "you added CATE in settings" apart from
   * "the signed key is allowed to sell CATE" — those are different facts, and
   * only the second one is true without a re-sign. Without this the mismatch
   * would only surface as a UserOp reverting at the wall, long after the owner
   * thought they'd enabled it.
   */
  grantTokens?: string[];
  /** TESTNET ONLY — production signers live in a TEE, never serialized. */
  demoSessionPrivateKey: `0x${string}`;
  /**
   * TESTNET ONLY — the generated owner key that controls the account. When the
   * wallet is created in-browser (no external wallet connected) this is the ONLY
   * way to recover funds, so the UI forces the user to back it up before
   * funding. Absent when an external wallet (MetaMask) was the owner.
   */
  demoOwnerPrivateKey?: `0x${string}`;
}

/**
 * Addresses every grant can already approve without being asked to: USDG plus
 * the built-in tradable stock tokens. An owner-added entry that lands here needs
 * no extra permission and is never reported as uncovered.
 *
 * Shared deliberately. web/src/lib/session.ts skips these when baking extra
 * permissions into the call policy, and the worker skips them when deciding what
 * to warn about — if those two lists drifted, the warning would be wrong in one
 * direction or the other.
 */
export function builtinGrantTargets(grant?: Pick<StoredGrant, "grantFeatures"> | null): Set<string> {
  // No grant supplied = "what would a grant signed RIGHT NOW carry" — the
  // issuer's question. With a grant, the answer is whatever THAT signature
  // sealed, which for anything older than 2026-07-27 is the legacy three.
  const symbols =
    grant === undefined || grant?.grantFeatures?.includes(TRADEABLE_V2)
      ? (TRADEABLE_SYMBOLS as readonly string[])
      : (LEGACY_TRADEABLE_SYMBOLS as readonly string[]);
  return new Set<string>([
    (CASH.USDT as string).toLowerCase(),
    ...STOCK_TOKENS.filter((t) => symbols.includes(t.symbol)).map((t) => t.address.toLowerCase()),
  ]);
}

/**
 * Every token address this signature can approve for a SELL: the built-in set
 * it carries, plus any owner-added extras baked in at signing time.
 *
 * This is the set the worker checks a BUY against. Entering a position the key
 * cannot exit is the one outcome no cap protects you from.
 */
export function sellableAssets(grant: Pick<StoredGrant, "grantFeatures" | "grantTokens"> | null): Set<string> {
  const set = builtinGrantTargets(grant);
  for (const a of grant?.grantTokens ?? []) set.add(a.toLowerCase());
  return set;
}

/**
 * Which of the owner's configured tokens this signature actually lets the agent
 * sell. `grantTokens` absent means the grant predates the field entirely — and a
 * grant signed before extras existed genuinely has no extra approve permission
 * in its call policy, so "unknown" and "none" are the same fact here.
 */
export function tokenCoverage(
  configured: readonly CustomToken[],
  grant: Pick<StoredGrant, "grantTokens" | "grantFeatures"> | null | undefined,
): { covered: CustomToken[]; uncovered: CustomToken[] } {
  // Pass the grant through, not `undefined` — asking what THIS signature covers,
  // not what a fresh one would.
  const sellable = sellableAssets(grant ?? null);
  const covered: CustomToken[] = [];
  const uncovered: CustomToken[] = [];
  for (const t of configured) {
    (sellable.has(t.address.toLowerCase()) ? covered : uncovered).push(t);
  }
  return { covered, uncovered };
}

/**
 * Registry symbols the owner has selected that this grant cannot sell.
 *
 * The settings UI offers every symbol in the registry, but only the ones baked
 * into the signature can be approved for a sell — and approving USDG is generic,
 * so the buy side works regardless. That asymmetry is what let someone pick AAPL
 * and end up holding it forever. Reported, and refused at the wall.
 */
export function uncoveredBasketSymbols(
  basketSymbols: readonly string[],
  grant: Pick<StoredGrant, "grantFeatures" | "grantTokens"> | null | undefined,
): string[] {
  const sellable = sellableAssets(grant ?? null);
  return STOCK_TOKENS.filter(
    (t) => basketSymbols.includes(t.symbol) && !sellable.has(t.address.toLowerCase()),
  ).map((t) => t.symbol);
}
