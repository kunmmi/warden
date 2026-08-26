import { erc20Abi, type Address } from "viem";
import { PolicyFlags, RATE_LIMIT_POLICY_WITH_RESET_CONTRACT } from "@zerodev/permissions";
import { CallPolicyVersion, ParamCondition, toCallPolicy } from "@zerodev/permissions/policies";
import { toRateLimitPolicy, toTimestampPolicy } from "@zerodev/permissions/policies";
import { PANCAKESWAP_SWAP_ROUTER_ABI } from "./abis";
import { PANCAKESWAP } from "./protocols";
import { CASH, STOCK_TOKENS, TRADEABLE_SYMBOLS, USDT_DECIMALS, isValidCustomToken, type CustomToken } from "./tokens";
import { builtinGrantTargets, type GrantCaps } from "./grant";

/**
 * THE WALL. One definition, shared by every client that can sign a grant.
 *
 * This file decides what a session key is permitted to do once the account
 * contract is enforcing it — which assets it may approve, which routers may pull
 * them, how much per call, and when the key dies. It used to live inside the
 * dashboard's session.ts, which was fine while the dashboard was the only thing
 * that could sign. It is not fine with a phone app that can sign too: two copies
 * of this list would drift, nothing would fail when they did, and the difference
 * would be a wallet with permissions its owner never agreed to.
 *
 * So it is here, imported by both, and the tests in worker/src/wall.test.ts assert
 * the exact shape rather than trusting that a refactor preserved it.
 *
 * READ BEFORE CHANGING. Every entry below is a power granted to an automated
 * agent. Widening one is not a feature flag — it is a permanent change to what a
 * compromised agent could do with someone's money, and it only takes effect for
 * grants signed afterwards, so the fleet will be running a mix of walls.
 */

// v * 10**USDT_DECIMALS overflows Number's safe-integer range at 18dp (BSC's
// real USDT decimals, vs the original USDG's 6) — this is the money-path file
// that bakes caps into a signed grant, so getting the exact on-chain figure
// right matters even before v1's execution path exists. Scale through cents
// (safe in float space) and do the power-of-ten multiply in BigInt space.
const usdgUnits = (v: number): bigint => BigInt(Math.round(v * 100)) * 10n ** BigInt(USDT_DECIMALS - 2);

/**
 * THE SESSION KEY MAY EXECUTE, BUT IT MAY NOT SIGN.
 *
 * Everything else in this file is a CALL policy, and a call policy constrains
 * UserOp calls. It says nothing about signatures — and the permission validator
 * implements `signMessage` and `signTypedData` (@zerodev/permissions
 * toPermissionValidator), so with the library default (FOR_ALL_VALIDATION) the
 * session key can produce ERC-1271 signatures the account will honour.
 *
 * That was a hole straight through the wall on the original (Uniswap v4 +
 * Permit2) design this file used to carry, and the worst kind, because it
 * bypasses the wall rather than stretching it: Permit2 was an approved
 * spender and the stock approvals carry no amount condition, so a Permit2
 * `permitTransferFrom` SIGNED by the session key — and submitted by anyone,
 * from their own EOA — moved tokens to any recipient with no UserOp at all.
 * No call policy is consulted, the rate limit never fires, and nothing in the
 * ledger records it. The same shape covers EIP-2612 permits and any
 * off-chain order that settles against an ERC-1271 signature.
 *
 * NOT_FOR_VALIDATE_SIG closes it: the kernel refuses to validate signatures
 * from this permission, while UserOp execution is untouched. This costs
 * warden nothing — the entire trading path is UserOps (PancakeSwap v3's
 * SwapRouter takes a plain approve()/transferFrom(), not a signed permit —
 * see D008 in docs/DECISIONS.md), and the flag is cheap, standing insurance
 * against the same hole reopening if a future venue needs Permit2 again.
 * Grep confirms nothing in worker/, packages/ or web/src/lib signs with the
 * session account.
 *
 * The flag travels ON-CHAIN in the validator's enable data, so the account
 * itself enforces it — this is not a client-side promise. It is also hashed
 * into the permission id, which means it only takes effect for grants signed
 * AFTER this change: existing grants keep the old, permissive wall until
 * they're re-signed. See the header note about the fleet running a mix.
 */
export const WALL_POLICY_FLAG = PolicyFlags.NOT_FOR_VALIDATE_SIG;

/**
 * The only contract a token approval may ever name as spender.
 *
 * A single entry, deliberately: PancakeSwap v3's classic SwapRouter pulls
 * tokens directly via a standard ERC20 approve()/transferFrom() — there is no
 * Permit2 middleman the way Uniswap v4's UniversalRouter needs (see D008 in
 * docs/DECISIONS.md). Every additional approved spender is a standing licence
 * to move whatever it was approved for — the stock approvals below carry no
 * amount condition — so this list stays as short as the trading path allows.
 */
export function allowedSpenders(): Address[] {
  return [PANCAKESWAP.swapRouter as Address];
}

/**
 * The owner's choices that widen the wall beyond its secure default.
 *
 * Every field here defaults to the CLOSED position. That is the lesson of the
 * signature hole and the unpinned recipients: a default that happens to be
 * permissive survives for months because nothing fails. So the default wall
 * trades, and does nothing else.
 */
export interface WallOptions {
  extraTokens?: readonly CustomToken[];
  /**
   * Addresses USDG may be transferred OUT to.
   *
   * EMPTY (the default) means the wall carries NO transfer permission at all —
   * a compromised agent cannot move USDG to an address, full stop.
   *
   * This closes the largest remaining hole. The recipient used to be free-form
   * because chat transfers are user-confirmed, so the amount was the only
   * on-chain bound — but that bound is PER CALL, and the daily USDG cap is
   * enforced only off-chain, in the worker. A compromised worker ignores its
   * own counter, so the true on-chain ceiling was perTradeUsdg × maxOpsPerDay
   * every day until expiry: 2,400 USDG/day at the default preset. "Bounded"
   * in the sense that draining the account took a fortnight.
   *
   * Registering addresses is the same re-sign-to-widen model the token
   * allowlist already uses, and for the same reason: the wall cannot grow by
   * itself. Moving money out to an UNREGISTERED address remains possible any
   * time via the owner key (`warden recover`), which is not bound by the
   * wall — so this removes an agent's power, not the owner's.
   */
  withdrawalAddresses?: readonly Address[];
}

/**
 * Owner-added tokens that are safe to seal into a policy.
 *
 * Validated HERE, at the last point before an address becomes on-chain policy: a
 * malformed entry either bricks the grant or silently widens it. Anything already
 * covered by the built-in set is dropped so the policy carries no duplicates.
 */
export function usableExtraTokens(extraTokens: readonly CustomToken[] = []): CustomToken[] {
  const builtin = builtinGrantTargets();
  const seen = new Set<string>();
  return extraTokens.filter((t) => {
    if (!isValidCustomToken(t)) return false;
    const key = t.address.toLowerCase();
    if (builtin.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The call-policy permission list — pure data, which is what makes it testable.
 *
 * Deliberately separate from `buildWallPolicies` below: the ZeroDev Policy objects
 * are opaque once constructed, so asserting on them proves little. This returns
 * the thing that actually defines the wall, in a shape a test can read.
 */
export function buildCallPermissions(
  caps: GrantCaps,
  /**
   * The agent's own smart-account address — where value must land.
   *
   * REQUIRED, not optional with a fallback. An optional parameter would let a
   * caller silently rebuild the OLD wall, where the swap recipient and the
   * vault receiver were unconstrained, and nothing would fail — which is
   * exactly how the signature hole (WALL_POLICY_FLAG) survived: a default that
   * happened to be permissive.
   *
   * Available at policy-build time because the Kernel address derives from the
   * SUDO validator alone; the permission plugin is enabled at UserOp time and
   * does not affect it. Both signers derive a sudo-only account first, pin it
   * here, and then assert the final account matches.
   */
  smartAccount: Address,
  opts: WallOptions = {},
) {
  const spenders = allowedSpenders();
  const extras = usableExtraTokens(opts.extraTokens);
  const self = { condition: ParamCondition.EQUAL, value: smartAccount } as const;
  // Deduped and lowercased so a list with the same address twice doesn't bloat
  // the on-chain policy, and a case difference can't read as a second address.
  const withdrawals = [
    ...new Set((opts.withdrawalAddresses ?? []).map((a) => a.toLowerCase() as Address)),
  ];

  return [
    {
      // approve USDG, only to the allowed spenders, only up to one trade's size.
      target: CASH.USDT as Address,
      valueLimit: 0n,
      abi: erc20Abi,
      functionName: "approve",
      args: [
        { condition: ParamCondition.ONE_OF, value: spenders },
        { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: usdgUnits(caps.perTradeUsdg) },
      ],
    },
    // approve the TRADEABLE stock tokens so the agent can SELL what it may buy.
    // No amount condition: share counts are 18dp and not comparable to a USDG
    // cap, and a router can only pull what was approved — while the USDG cap
    // above already bounds what could ever have been bought.
    ...STOCK_TOKENS.filter((t) => (TRADEABLE_SYMBOLS as readonly string[]).includes(t.symbol)).map(
      (t) =>
        ({
          target: t.address as Address,
          valueLimit: 0n,
          abi: erc20Abi,
          functionName: "approve",
          args: [{ condition: ParamCondition.ONE_OF, value: spenders }, null],
        }) as const,
    ),
    // Owner-added tokens, same shape and same routers. Present ONLY because the
    // owner listed them and is signing this grant right now — which is precisely
    // why the wall cannot widen by itself.
    ...extras.map(
      (t) =>
        ({
          target: t.address as Address,
          valueLimit: 0n,
          abi: erc20Abi,
          functionName: "approve",
          args: [{ condition: ParamCondition.ONE_OF, value: spenders }, null],
        }) as const,
    ),
    // USDG out of the wall — ONLY to addresses the owner registered, and only
    // one trade's worth per call. Absent entirely when the list is empty, which
    // is the default: no registered destination, no power to send.
    //
    // The recipient used to be free-form, leaving the per-call amount as the
    // only on-chain bound — and since the daily USDG cap lives off-chain in the
    // worker, a compromised worker's real ceiling was perTradeUsdg ×
    // maxOpsPerDay per day, every day, until expiry.
    ...(withdrawals.length > 0
      ? [
          {
            target: CASH.USDT as Address,
            valueLimit: 0n,
            abi: erc20Abi,
            functionName: "transfer",
            args: [
              { condition: ParamCondition.ONE_OF, value: withdrawals },
              { condition: ParamCondition.LESS_THAN_OR_EQUAL, value: usdgUnits(caps.perTradeUsdg) },
            ],
          } as const,
        ]
      : []),
    {
      // PancakeSwap v3 SwapRouter: exactInputSingle only, AND the output must
      // land in the agent's own account.
      //
      // Without the recipient pin, the approve cap above bounds only how much
      // can be spent per call — not who receives the proceeds. A compromised
      // agent could swap USDT for a token and direct the output anywhere, over
      // and over, up to the daily cap. "Bounded by the approve cap" was true
      // and beside the point: the money still left.
      //
      // WHY THE ARGS ARRAY IS EIGHT LONG FOR A ONE-PARAMETER FUNCTION. The
      // call policy maps args[i] to calldata offset i*32 (see
      // @zerodev/permissions callPolicyUtils getPermissionFromABI) — a FLAT
      // positional mapping with no ABI arity check. ExactInputSingleParams is
      // a tuple of eight STATIC members here (PancakeSwap kept `deadline`,
      // which Uniswap's SwapRouter02 dropped — see D008 in docs/DECISIONS.md),
      // so the ABI encoder lays it out inline as eight consecutive words
      // rather than behind a pointer. Index 3 is still exactly `recipient` —
      // deadline was inserted AFTER recipient, not before — but the array
      // must be eight long or every index past the insertion point reads the
      // wrong word.
      //
      // That alignment is real but fragile: it depends on the tuple staying
      // all-static and the member order not moving. wall.test.ts proves the
      // offset against viem's own encoder rather than against this reasoning —
      // if SwapRouter's struct ever changes, that test fails loudly instead
      // of the policy quietly constraining the wrong word.
      target: PANCAKESWAP.swapRouter as Address,
      valueLimit: 0n,
      abi: PANCAKESWAP_SWAP_ROUTER_ABI,
      functionName: "exactInputSingle",
      args: [null, null, null, self, null, null, null, null],
    },
  ];
}

/**
 * The complete policy set for a grant: expiry, rate limit, and the call policy.
 *
 * `now` is injectable so a test can assert the timestamps rather than racing the
 * clock. Callers should leave it alone.
 */
export function buildWallPolicies(args: {
  caps: GrantCaps;
  /** The agent's own account — see buildCallPermissions. Required, never defaulted. */
  smartAccount: Address;
  now?: number;
} & WallOptions) {
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const expiresAt = now + args.caps.expiryDays * 86_400;

  const policies = [
    // Hard expiry — the key dies even if every other control fails.
    toTimestampPolicy({ validAfter: now, validUntil: expiresAt }),
    // Bounded ops per day, so a runaway loop cannot spam trades.
    //
    // Deliberately the WITH_RESET module, not @zerodev/permissions' default
    // RATE_LIMIT_POLICY_CONTRACT (0xf63d4139...86873) — that address has NO
    // bytecode on BSC testnet (confirmed via eth_getCode), which made every
    // enable-mode UserOp for a wall-governed account revert with an empty
    // AA13/AA23, since Kernel's policy-install loop hit a code-less address.
    // RATE_LIMIT_POLICY_WITH_RESET_CONTRACT is functionally identical for our
    // use (we never pass `startAt`, the one field it doesn't support) and is
    // deployed on BOTH BSC mainnet and testnet — confirmed via eth_getCode on
    // both chains — so this is a single code path, not a chain-conditional one.
    toRateLimitPolicy({
      count: args.caps.maxOpsPerDay,
      interval: 86_400,
      policyAddress: RATE_LIMIT_POLICY_WITH_RESET_CONTRACT,
    }),
    toCallPolicy({
      policyVersion: CallPolicyVersion.V0_0_4,
      permissions: buildCallPermissions(args.caps, args.smartAccount, {
        extraTokens: args.extraTokens,
        withdrawalAddresses: args.withdrawalAddresses,
      }) as never,
    }),
  ];

  return { policies, now, expiresAt };
}
