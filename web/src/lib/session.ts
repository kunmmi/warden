"use client";

/**
 * The permission wall — creating an agent account and granting it a scoped key.
 *
 * NO EXTERNAL WALLET. The account's owner key is generated in the browser, so
 * there's nothing to connect — you create the wallet, back up its owner key,
 * and fund the account address. The flow (all counterfactual — nothing is
 * deployed until the agent's first trade):
 *  1. A fresh OWNER keypair is generated → it's the Kernel account's sudo
 *     validator (ECDSA). The smart-account address derives from it.
 *  2. A fresh SESSION keypair is generated for the agent.
 *  3. The session key is wrapped in a permission validator whose policies are
 *     enforced BY THE ACCOUNT CONTRACT on every UserOp:
 *       - call policy: only approve(USDG→allowed targets) with capped amounts,
 *         only vault.deposit with capped assets, only the Rialto router
 *       - rate limit: bounded ops per day
 *       - timestamp: hard expiry
 *  4. The owner key signs the grant locally (no popup); the serialized grant is
 *     what the worker uses to act. Revocation = expiry (or nonce invalidation).
 *
 * TESTNET DEMO CAVEATS (labeled in the UI): both private keys are kept in
 * localStorage so you can inspect and back them up; production owner keys live
 * in a Turnkey TEE and never touch a browser. Whoever holds the owner key
 * controls the funds — the UI forces a backup before funding. Drawdown breaker
 * is worker-enforced until the breaker contract ships (Phase 2).
 */

import { createPublicClient, erc20Abi, formatUnits, http, parseAbi, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createKernelAccount } from "@zerodev/sdk";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  serializePermissionAccount,
  toPermissionValidator,
} from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import {
  CallPolicyVersion,
  ParamCondition,
  toCallPolicy,
  toRateLimitPolicy,
  toTimestampPolicy,
} from "@zerodev/permissions/policies";
import {
  CASH,
  MORPHO,
  RIALTO,
  STOCK_TOKENS,
  TRADEABLE_SYMBOLS,
  UNISWAP,
  UNISWAP_SWAP_ROUTER_ABI,
  PERMIT2_ABI,
  UNIVERSAL_ROUTER_ABI,
  buildWallPolicies,
  WALL_POLICY_FLAG,
  usableExtraTokens,
  chainForId,
  bscTestnet,
  GRANT_V4,
  TRADEABLE_V2,
  USDT_DECIMALS,
  type CustomToken,
  type GrantCaps,
  type StoredGrant,
} from "@warden/core";

export type { GrantCaps, StoredGrant };

/**
 * Testnet gas faucet — where users top up the account's native balance.
 * VERIFIED 2026-08-04: BNB Chain's official faucet listing, linked directly
 * from docs.bnbchain.org/bnb-smart-chain/developers/faucet/.
 */
export const FAUCET_URL = "https://www.bnbchain.org/en/testnet-faucet";

const VAULT_ABI = parseAbi([
  "function deposit(uint256 assets, address receiver) returns (uint256)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256)",
]);

export type Grant = StoredGrant;

const STORAGE_KEY = "warden.grant.v1";

export function loadGrant(): Grant | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Grant) : null;
  } catch {
    return null;
  }
}

export function clearGrant(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// See worker/src/index.ts's usdg() for why this goes through cents rather
// than `v * 10 ** USDT_DECIMALS` directly — that overflows float precision
// at 18dp (BSC's real USDT decimals, vs the original USDG's 6).
const usdgUnits = (v: number) => BigInt(Math.round(v * 100)) * 10n ** BigInt(USDT_DECIMALS - 2);

/**
 * Mint a grant for a given OWNER key: derive the Kernel account, generate a
 * fresh session key, wrap it in the policy validator, and seal the grant.
 *
 * The account address derives from the owner key alone (the sudo ECDSA
 * validator + factory + index) — the session/permission plugin is enabled at
 * UserOp time and does NOT affect the address. That's what makes restore work:
 * the same owner key always reproduces the same smart account, so an existing
 * funded wallet can be re-armed with a brand-new session key.
 */
async function mintGrant(
  ownerPrivateKey: `0x${string}`,
  caps: GrantCaps,
  onStatus: (status: string) => void,
  chainId: number,
  /**
   * Owner-added tokens to bake into the call policy alongside the built-in
   * tradable set. Passing them is what actually lets the agent SELL them —
   * adding a token in settings does nothing until a grant covering it is signed.
   */
  extraTokens: readonly CustomToken[] = [],
): Promise<Grant> {
  // Testnet is the sandbox; mainnet (4663) is real funds — the UI gates that
  // choice behind an explicit consent step. Note: the call-policy addresses
  // below (UNISWAP/RIALTO/MORPHO/USDG) are MAINNET deployments — the wall is
  // real on mainnet and inert on testnet, where those contracts don't exist
  // and swaps no-route by design.
  const chain = chainForId(chainId);
  const publicClient = createPublicClient({ chain, transport: http() });

  const entryPoint = getEntryPoint("0.7");
  const kernelVersion = KERNEL_V3_3;

  const ownerAccount = privateKeyToAccount(ownerPrivateKey);
  const owner = ownerAccount.address;

  onStatus("deriving your smart account…");
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: ownerAccount,
    entryPoint,
    kernelVersion,
  });

  const sessionPrivateKey = generatePrivateKey();
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);
  const sessionSigner = await toECDSASigner({ signer: sessionAccount });

  // THE ACCOUNT ADDRESS, BEFORE THE WALL — because the wall now pins value to
  // it. The Kernel address derives from the SUDO validator alone; the
  // permission plugin is enabled at UserOp time and does not affect it (the
  // same fact that makes restore work). So derive the sudo-only account first,
  // pin the swap recipient / vault receiver to it, and assert below that the
  // full account came out identical.
  const sudoOnlyAccount = await createKernelAccount(publicClient, {
    entryPoint,
    kernelVersion,
    plugins: { sudo: ecdsaValidator },
  });

  // THE WALL now lives in packages/core/src/wall.ts, so the phone app signs the
  // IDENTICAL permission set rather than a second copy that could drift from this
  // one with nothing failing when it did. worker/src/wall.test.ts pins its shape.
  const { policies, now, expiresAt } = buildWallPolicies({
    caps,
    smartAccount: sudoOnlyAccount.address,
    extraTokens,
  });

  const permissionValidator = await toPermissionValidator(publicClient, {
    entryPoint,
    kernelVersion,
    signer: sessionSigner,
    policies,
    // Execute, but never sign. Without this the session key can produce
    // ERC-1271 signatures — which a CALL policy cannot constrain — and a
    // signed Permit2 transfer drains the account with no UserOp at all.
    // See WALL_POLICY_FLAG in packages/core/src/wall.ts.
    flag: WALL_POLICY_FLAG,
  });

  const account = await createKernelAccount(publicClient, {
    entryPoint,
    kernelVersion,
    plugins: {
      sudo: ecdsaValidator,
      regular: permissionValidator,
    },
  });

  // THE PREMISE, CHECKED. The wall pins the swap recipient and vault receiver
  // to the sudo-only address derived above, which is only correct because the
  // permission plugin does not change the account address. If that ever stops
  // being true, every pin would point at an account that doesn't exist and the
  // agent would be unable to trade — or worse, at someone else's. Fail here,
  // loudly, before a grant is sealed, rather than discovering it on-chain.
  if (account.address.toLowerCase() !== sudoOnlyAccount.address.toLowerCase()) {
    throw new Error(
      `refusing to seal this grant: the permission plugin changed the account address ` +
        `(${sudoOnlyAccount.address} → ${account.address}), so the wall's recipient pins are wrong.`,
    );
  }

  onStatus("sealing the permission grant…");
  const serialized = await serializePermissionAccount(account, sessionPrivateKey);

  const grant: Grant = {
    smartAccount: account.address,
    owner,
    sessionKeyAddress: sessionAccount.address,
    serialized,
    caps,
    grantedAt: now,
    expiresAt,
    chainId: chain.id,
    // TRADEABLE_V2 says this signature carries the WIDE stock allowlist. Without
    // it the worker assumes the legacy three — because a grant signed before the
    // list grew genuinely only has those three in its call policy, and crediting
    // it with more is how a position gets bought and never sold.
    grantFeatures: ["transfer", TRADEABLE_V2, GRANT_V4],
    // What this signature ACTUALLY covers — the worker compares it against the
    // owner's configured tokens and says so when they've drifted apart.
    // Same filter the wall itself applied, so what we RECORD as covered and what
    // the policy actually covers cannot disagree — the worker compares this
    // against the owner's configured tokens and warns when they've drifted.
    grantTokens: usableExtraTokens(extraTokens).map((t) => t.address.toLowerCase()),
    demoSessionPrivateKey: sessionPrivateKey,
    demoOwnerPrivateKey: ownerPrivateKey,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(grant));

  // Hand the grant to the worker (dev-mode file handoff; Supabase later).
  onStatus("handing the grant to the worker…");
  try {
    await fetch("/api/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(grant),
    });
  } catch {
    // Worker handoff failing must not lose the signed grant — it's in localStorage.
  }

  return grant;
}

/**
 * Create a BRAND-NEW agent wallet: a fresh owner key is generated in-browser
 * (this is the account's sudo signer and the root of fund custody — no external
 * wallet, nothing to connect), then a grant is sealed on it.
 */
export async function createAgentWallet(
  caps: GrantCaps,
  onStatus: (status: string) => void,
  chainId: number = bscTestnet.id,
  extraTokens: readonly CustomToken[] = [],
): Promise<Grant> {
  onStatus("minting your agent's owner key…");
  return mintGrant(generatePrivateKey(), caps, onStatus, chainId, extraTokens);
}

/**
 * RESTORE an existing agent wallet from its backed-up owner key — the way back
 * in after a kill switch, a discarded grant, or a new machine. The same owner
 * key re-derives the SAME smart account, so a wallet you already funded comes
 * back to life with a brand-new session key and whatever caps you pick now.
 * Nothing moves on-chain; no funds are touched.
 *
 * This is also the RE-SIGN path for widening the tradable set: adding a token in
 * settings can't reach into an already-signed key, so covering it means minting
 * a new grant over the same account. Same address, same funds, new wall.
 */
export async function restoreAgentWallet(
  ownerPrivateKey: `0x${string}`,
  caps: GrantCaps,
  onStatus: (status: string) => void,
  chainId: number = bscTestnet.id,
  extraTokens: readonly CustomToken[] = [],
): Promise<Grant> {
  onStatus("re-deriving your smart account from the owner key…");
  return mintGrant(ownerPrivateKey, caps, onStatus, chainId, extraTokens);
}

export interface OwnerPreview {
  /** The smart account this owner key controls — where your funds actually are. */
  smartAccount: Address;
  /** The owner key's own EOA — what MetaMask would show (usually empty). */
  owner: Address;
}

/**
 * Read-only: which smart account does this owner key control? Lets the restore
 * flow show the derived address (and its balances) so the user can confirm it's
 * the funded wallet they meant BEFORE anything is signed or armed.
 */
export async function previewOwnerAccount(
  ownerPrivateKey: `0x${string}`,
  chainId: number = bscTestnet.id,
): Promise<OwnerPreview> {
  const chain = chainForId(chainId);
  const publicClient = createPublicClient({ chain, transport: http() });
  const ownerAccount = privateKeyToAccount(ownerPrivateKey);
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: ownerAccount,
    entryPoint: getEntryPoint("0.7"),
    kernelVersion: KERNEL_V3_3,
  });
  // sudo-only derivation — the permission plugin doesn't change the address.
  const account = await createKernelAccount(publicClient, {
    entryPoint: getEntryPoint("0.7"),
    kernelVersion: KERNEL_V3_3,
    plugins: { sudo: ecdsaValidator },
  });
  return { smartAccount: account.address, owner: ownerAccount.address };
}

/** Live on-chain balances of the account address — for the "fund it" step. */
export interface Funding {
  gasWei: bigint;
  usdgUnits: bigint;
  usdg: number;
}

export async function readFunding(smartAccount: Address, chainId: number = bscTestnet.id): Promise<Funding> {
  const publicClient = createPublicClient({ chain: chainForId(chainId), transport: http() });
  const [gasWei, usdgUnits] = await Promise.all([
    publicClient.getBalance({ address: smartAccount }).catch(() => 0n),
    publicClient
      .readContract({
        address: CASH.USDT as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [smartAccount],
      })
      .then((v) => v as bigint)
      .catch(() => 0n),
  ]);
  // formatUnits does the bigint->decimal-string division exactly; Number()
  // on that string is safe for realistic balance sizes. Number(usdgUnits) /
  // 10 ** USDT_DECIMALS would do the division in float space instead, which
  // is the same class of precision loss as usdgUnits() above.
  return { gasWei, usdgUnits, usdg: Number(formatUnits(usdgUnits, USDT_DECIMALS)) };
}
