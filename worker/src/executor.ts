/**
 * Agent executor — turns an approved, simulated intent into a UserOperation
 * signed by the agent's session key. The Kernel account contract re-checks the
 * grant's policies on-chain; this code cannot exceed them even if buggy.
 *
 * Needs a bundler:
 *   WARDEN_BUNDLER_URL   e.g. Pimlico/Alchemy bundler RPC for BSC chain 97/56
 *
 * The serialized grant embeds the session private key for the TESTNET demo
 * (mirrors web/src/lib/session.ts). Production: Turnkey TEE holds the key and
 * this module signs via its API instead of deserializing a local key.
 */

import { http, createPublicClient, type Chain, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createKernelAccount, createKernelAccountClient } from "@zerodev/sdk";
import { toKernelPluginManager } from "@zerodev/sdk/accounts";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import {
  decodeParamsFromInitCode,
  toPermissionValidator,
  type PermissionAccountParams,
  type Policy,
} from "@zerodev/permissions";
import {
  toCallPolicy,
  toGasPolicy,
  toRateLimitPolicy,
  toSignatureCallerPolicy,
  toSudoPolicy,
  toTimestampPolicy,
} from "@zerodev/permissions/policies";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { WALL_POLICY_FLAG } from "../../packages/core/src/index";
import { userOpGasConfig } from "./gas";

export interface Call {
  to: `0x${string}`;
  value: bigint;
  data: Hex;
}

export interface AgentExecutor {
  /** Counterfactual smart-account address (deploys itself on first op). */
  address: `0x${string}`;
  /** Send a batch of calls as one UserOperation; resolves to the tx hash. */
  execute(calls: Call[]): Promise<`0x${string}`>;
}

/**
 * Same {policyType -> to*Policy()} switch @zerodev/permissions' own
 * deserializePermissionAccount.ts uses internally (as `createPolicyFromParams`)
 * — duplicated here because that function isn't part of the package's public
 * API (see the WHY comment on deserializePermissionAccountWithWallFlag below
 * for why we can't just call the real deserializePermissionAccount instead).
 */
async function createPolicyFromParams(policy: Policy) {
  switch (policy.policyParams.type) {
    case "call":
      return await toCallPolicy(policy.policyParams);
    case "gas":
      return await toGasPolicy(policy.policyParams);
    case "rate-limit":
      return await toRateLimitPolicy(policy.policyParams);
    case "signature-caller":
      return await toSignatureCallerPolicy(policy.policyParams);
    case "sudo":
      return await toSudoPolicy(policy.policyParams);
    case "timestamp":
      return await toTimestampPolicy(policy.policyParams);
    default:
      throw new Error(`unsupported policy type in serialized grant: ${(policy.policyParams as { type: string }).type}`);
  }
}

/**
 * A from-scratch reimplementation of @zerodev/permissions' own
 * deserializePermissionAccount — because that function has a real bug (as of
 * @zerodev/permissions@5.6.3, still latest as of 2026-08-07, confirmed by
 * reading its source directly in node_modules) that makes it incompatible
 * with WALL_POLICY_FLAG.
 *
 * THE BUG: toPermissionValidator's `flag` parameter is baked directly into
 * the `enableData` bytes it builds (`concat([flag, signer.signerContractAddress,
 * signer.getSignerData()])` in toPermissionValidator.ts) — those bytes are
 * what the account's stored `enableSignature` was originally computed over,
 * at grant-signing time in web/src/lib/session.ts, where `flag:
 * WALL_POLICY_FLAG` is passed explicitly (see wall.ts's WALL_POLICY_FLAG doc
 * comment for why: closing the ERC-1271 signature hole). But
 * deserializePermissionAccount.ts calls toPermissionValidator WITHOUT a
 * `flag` argument at all — and PermissionData (the serialized-params type)
 * has no `flag` field to read one back from either. So on deserialize, `flag`
 * silently falls back to toPermissionValidator's own default
 * (PolicyFlags.FOR_ALL_VALIDATION) — different bytes, different on-chain
 * digest, and the stored enableSignature (signed against the ORIGINAL bytes)
 * no longer recovers to the owner's address. The account's Kernel contract
 * then reverts with `EnableNotApproved()` on the very first UserOp — this
 * was caught live, on BSC testnet, via `--selftest`, not in a unit test.
 *
 * THE FIX: everything below is deserializePermissionAccount's own logic,
 * copied faithfully, with exactly one addition — `flag: WALL_POLICY_FLAG` on
 * the toPermissionValidator call. If a future @zerodev/permissions release
 * adds a `flag` passthrough to its own deserializePermissionAccount, this
 * whole function should be deleted in favor of that.
 */
export async function deserializePermissionAccountWithWallFlag(
  client: Parameters<typeof createKernelAccount>[0],
  entryPoint: ReturnType<typeof getEntryPoint>,
  serializedGrant: string,
) {
  const json = new TextDecoder().decode(Buffer.from(serializedGrant, "base64"));
  const params = JSON.parse(json) as PermissionAccountParams;
  if (!params.privateKey) throw new Error("serialized grant has no session private key");

  const signer = await toECDSASigner({ signer: privateKeyToAccount(params.privateKey) });
  const policies = await Promise.all((params.permissionParams.policies ?? []).map(createPolicyFromParams));

  const permissionPlugin = await toPermissionValidator(client, {
    signer,
    policies,
    entryPoint,
    kernelVersion: KERNEL_V3_3,
    permissionId: params.permissionParams.permissionId,
    flag: WALL_POLICY_FLAG, // the fix — see the WHY comment above
  });

  const { index, validatorInitData, useMetaFactory } = decodeParamsFromInitCode(
    params.accountParams.initCode,
    KERNEL_V3_3,
  );

  const kernelPluginManager = await toKernelPluginManager(client, {
    regular: permissionPlugin,
    pluginEnableSignature: params.isPreInstalled ? undefined : params.enableSignature,
    validatorInitData,
    action: params.action,
    entryPoint,
    kernelVersion: KERNEL_V3_3,
    isPreInstalled: params.isPreInstalled,
    ...params.validityData,
  });

  return createKernelAccount(client, {
    entryPoint,
    kernelVersion: KERNEL_V3_3,
    plugins: kernelPluginManager,
    index,
    address: params.accountParams.accountAddress,
    useMetaFactory,
    eip7702Auth: params.eip7702Auth,
  });
}

export async function createAgentExecutor(opts: {
  chain: Chain;
  serializedGrant: string;
  bundlerUrl: string;
  /** RPC override (settings rpcMainnet/rpcTestnet) — falls back to the chain default. */
  rpcUrl?: string;
}): Promise<AgentExecutor> {
  const publicClient = createPublicClient({ chain: opts.chain, transport: http(opts.rpcUrl) });
  const entryPoint = getEntryPoint("0.7");

  const account = await deserializePermissionAccountWithWallFlag(
    publicClient,
    entryPoint,
    opts.serializedGrant,
  );

  const client = createKernelAccountClient({
    account,
    chain: opts.chain,
    bundlerTransport: http(opts.bundlerUrl),
    // Without this the SDK calls the ZeroDev-only `zd_getUserOperationGasPrice`,
    // which Pimlico/Alchemy/self-hosted bundlers reject — see worker/src/gas.ts.
    userOperation: userOpGasConfig(publicClient, opts.bundlerUrl),
  });

  return {
    address: account.address,
    async execute(calls: Call[]) {
      const userOpHash = await client.sendUserOperation({
        callData: await account.encodeCalls(calls),
      });
      const receipt = await client.waitForUserOperationReceipt({ hash: userOpHash });
      if (!receipt.success) {
        // Surface the on-chain revert reason when the bundler provides one.
        const reason = (receipt as { reason?: string }).reason;
        throw new Error(`reverted on-chain${reason ? `: ${reason}` : ""} (${userOpHash})`);
      }
      return receipt.receipt.transactionHash;
    },
  };
}
