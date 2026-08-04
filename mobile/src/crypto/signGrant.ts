import { createPublicClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createKernelAccount } from "@zerodev/sdk";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { serializePermissionAccount, toPermissionValidator } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import {
  GRANT_V4,
  TRADEABLE_V2,
  buildWallPolicies,
  WALL_POLICY_FLAG,
  bscChain,
  usableExtraTokens,
  type CustomToken,
  type GrantCaps,
  type StoredGrant,
} from "@warden/core";
import { accountFromMnemonic } from "./mnemonic";
import { isMock } from "@/net/api";

/**
 * Sign a grant on the phone.
 *
 * THE ONE RULE: the owner key never leaves this device. It is derived from the
 * mnemonic in memory, used to build the sudo validator, and dropped. What comes
 * out is a serialized SESSION account — capped on-chain, self-expiring, revocable
 * — and that is the only thing safe to hand to a server.
 *
 * This deliberately does NOT mirror the dashboard's session.ts, which puts
 * `demoOwnerPrivateKey` on the grant object and POSTs the whole thing to
 * /api/grants. On a self-hosted install that is a localhost round trip to a 0600
 * file on the same machine, so it is not a leak. From a phone talking to a hosted
 * API it would upload the owner key to someone else's server, which would make the
 * product's central claim false. So the field is simply absent here.
 *
 * The policy set itself comes from packages/core so the phone and the dashboard
 * sign the IDENTICAL wall — see packages/core/src/wall.ts, pinned by
 * worker/src/wall.test.ts.
 */

export type SignProgress = (step: string) => void;

export interface SignedGrant {
  /** Safe to transmit: capped, expiring, and useless outside its policies. */
  grant: Omit<StoredGrant, "demoOwnerPrivateKey">;
  /** The session key, which the worker needs in order to act. Not the owner key. */
  sessionPrivateKey: `0x${string}`;
}

export async function signGrant(args: {
  mnemonic: string;
  caps: GrantCaps;
  extraTokens?: readonly CustomToken[];
  rpcUrl?: string;
  onProgress?: SignProgress;
}): Promise<SignedGrant> {
  // A DEMO BUILD MUST NOT MINT A FUNDABLE ACCOUNT.
  //
  // `isMock` used to gate only what the screens DISPLAY — the feed and the
  // Telegram card. It never reached here, and there is no testnet path: the
  // chain below is Robinhood Chain 4663, mainnet, unconditionally. So a demo
  // build generated a real key, derived a real mainnet smart account, showed
  // the owner its address, and then reported a portfolio that was entirely
  // invented. Anyone who funded that address had put real money somewhere the
  // app was lying about, with one small chip as the only warning.
  //
  // The guard lives at the signing chokepoint rather than on the screen,
  // because the screen is reachable by deep link (`merrymen://onboarding/grant`)
  // and a UI-only check would be routed around rather than enforced.
  //
  // Deliberately NOT applied to recovery: sweeping funds out is the escape
  // hatch, and blocking it would strand anyone who reached this state before
  // the guard existed. Close the trap, keep the exit.
  if (isMock) {
    throw new Error(
      "This is a demo build — it reads generated data, so it will not sign a real permission wall. " +
        "Install a build configured for your own agent to do that.",
    );
  }

  const say = args.onProgress ?? (() => {});
  const chain = bscChain;
  const publicClient = createPublicClient({
    chain,
    transport: http(args.rpcUrl ?? chain.rpcUrls.default.http[0]),
  });
  const entryPoint = getEntryPoint("0.7");

  say("deriving your key");
  const ownerAccount = accountFromMnemonic(args.mnemonic);

  say("building the sudo validator");
  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer: ownerAccount,
    entryPoint,
    kernelVersion: KERNEL_V3_3,
  });

  say("minting a session key");
  const sessionPrivateKey = generatePrivateKey();
  const sessionSigner = await toECDSASigner({ signer: privateKeyToAccount(sessionPrivateKey) });

  // The address BEFORE the wall, because the wall pins value to it. The Kernel
  // address derives from the sudo validator alone — the permission plugin is
  // enabled at UserOp time and does not affect it — so this is knowable now,
  // and asserted identical below.
  say("deriving your account");
  const sudoOnlyAccount = await createKernelAccount(publicClient, {
    entryPoint,
    kernelVersion: KERNEL_V3_3,
    plugins: { sudo: ecdsaValidator },
  });

  say("assembling the wall");
  const { policies, now, expiresAt } = buildWallPolicies({
    caps: args.caps,
    smartAccount: sudoOnlyAccount.address,
    extraTokens: args.extraTokens,
  });

  say("attaching the permissions");
  const permissionValidator = await toPermissionValidator(publicClient, {
    entryPoint,
    kernelVersion: KERNEL_V3_3,
    signer: sessionSigner,
    policies,
    // Execute, but never sign — the same flag the dashboard signs with. Both
    // read it from core so the two signers cannot drift, exactly like the
    // permission list itself. See WALL_POLICY_FLAG in packages/core/src/wall.ts.
    flag: WALL_POLICY_FLAG,
  });

  say("deriving the smart account");
  const account = await createKernelAccount(publicClient, {
    entryPoint,
    kernelVersion: KERNEL_V3_3,
    plugins: { sudo: ecdsaValidator, regular: permissionValidator },
  });

  // Same premise check the dashboard makes: the wall's recipient pins are only
  // correct while the permission plugin leaves the address alone. Fail before
  // sealing, never after.
  if (account.address.toLowerCase() !== sudoOnlyAccount.address.toLowerCase()) {
    throw new Error(
      `refusing to sign: the permission plugin changed the account address ` +
        `(${sudoOnlyAccount.address} → ${account.address}), so the wall's recipient pins are wrong.`,
    );
  }

  say("signing");
  const serialized = await serializePermissionAccount(account, sessionPrivateKey);

  return {
    grant: {
      smartAccount: account.address,
      // The owner's ADDRESS, which is public. Not the key.
      owner: ownerAccount.address,
      sessionKeyAddress: sessionSigner.account.address,
      serialized,
      caps: args.caps,
      grantedAt: now,
      expiresAt,
      chainId: chain.id,
      // Tells the worker what this signature actually carries, rather than
      // letting it infer capabilities from a constant that may have moved since.
      grantFeatures: ["transfer", TRADEABLE_V2, GRANT_V4],
      grantTokens: usableExtraTokens(args.extraTokens).map((t) => t.address.toLowerCase()),
      demoSessionPrivateKey: sessionPrivateKey,
    },
    sessionPrivateKey,
  };
}
