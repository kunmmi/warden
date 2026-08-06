import assert from "node:assert/strict";
import { PolicyFlags } from "@zerodev/permissions";
import { ParamCondition } from "@zerodev/permissions/policies";
import { encodeFunctionData, pad } from "viem";
import test from "node:test";
import {
  CASH,
  PANCAKESWAP,
  PANCAKESWAP_SWAP_ROUTER_ABI,
  STOCK_TOKENS,
  TRADEABLE_SYMBOLS,
  allowedSpenders,
  buildCallPermissions,
  buildWallPolicies,
  WALL_POLICY_FLAG,
  usableExtraTokens,
  type GrantCaps,
} from "../../packages/core/src/index";

/**
 * THE WALL, PINNED.
 *
 * These assertions are a specification, not a snapshot. The permission list moved
 * out of the dashboard so a phone could sign the same grant, and the danger in
 * that move is silent: drop one entry, loosen one condition, reorder the args of
 * an approve, and nothing throws — grants just start carrying powers their owners
 * did not agree to, and only for the people who signed after the change.
 *
 * So each expectation below was read off the ORIGINAL dashboard implementation and
 * written down independently. If a future edit widens the wall, this fails and
 * says which entry.
 *
 * As of D008 (docs/DECISIONS.md), the wall carries exactly one router —
 * PancakeSwap v3's classic SwapRouter — and nothing else: no Permit2, no
 * UniversalRouter, no Rialto, no Morpho vault. Those were all Robinhood-Chain-
 * era conveniences with no verified BSC equivalent (Rialto, Morpho) or no
 * reason to exist against PancakeSwap's direct-approve router (Permit2,
 * UniversalRouter) — see wall.ts's allowedSpenders() doc comment.
 */

const CAPS: GrantCaps = {
  perTradeUsdg: 50,
  dailyUsdg: 500,
  expiryDays: 14,
  maxDrawdownPct: 10,
  maxOpsPerDay: 48,
};

/** USDT on BSC is 18dp (not Ethereum's 6) — the units a cap is actually expressed in on-chain. */
const usdg = (v: number) => BigInt(Math.round(v * 1e18));

type Perm = ReturnType<typeof buildCallPermissions>[number] & {
  target: string;
  functionName?: string;
  args?: unknown[];
};

/** The agent's own account — what the wall pins swap destinations to. */
const SELF = "0x00000000000000000000000000000000000000a9" as const;
const perms = () => buildCallPermissions(CAPS, SELF) as unknown as Perm[];
const find = (target: string, fn?: string) =>
  perms().filter((p) => p.target.toLowerCase() === target.toLowerCase() && (fn === undefined || p.functionName === fn));

test("the only approved spender is PancakeSwap's SwapRouter", () => {
  // A single entry, deliberately: PancakeSwap v3's classic router pulls tokens
  // directly via approve()/transferFrom(), so there is no Permit2 middleman —
  // and every additional approved spender is a standing licence to move
  // whatever it was approved for, since the stock approvals carry no amount
  // condition.
  const s = allowedSpenders().map((a) => a.toLowerCase());
  assert.deepEqual(s, [PANCAKESWAP.swapRouter.toLowerCase()]);
});

test("USDG approve is capped at ONE TRADE and restricted to the allowed spenders", () => {
  const [p] = find(CASH.USDT, "approve");
  assert.ok(p, "USDG approve permission must exist");
  const [spender, amount] = p.args as [{ condition: number; value: string[] }, { condition: number; value: bigint }];
  assert.equal(spender.value.length, 1, "the one approved spender — PancakeSwap's SwapRouter");
  // The cap is per TRADE, not per day. Using dailyUsdg here would let one approval
  // authorise ten trades' worth.
  assert.equal(amount.value, usdg(CAPS.perTradeUsdg));
});

test("by DEFAULT there is no way to send USDG out at all", () => {
  // The recipient used to be free-form, which left the per-call amount as the
  // only on-chain bound — and the daily USDG cap lives off-chain, in the very
  // worker that would be compromised. The real ceiling was therefore
  // perTradeUsdg x maxOpsPerDay per day until expiry (2,400/day at the default
  // preset): "bounded" only in that draining took a fortnight.
  assert.equal(find(CASH.USDT, "transfer").length, 0, "no registered address, no power to send");
});

test("registering withdrawal addresses pins the recipient to exactly those", () => {
  const A = "0x1111111111111111111111111111111111111111" as const;
  const B = "0x2222222222222222222222222222222222222222" as const;
  const list = buildCallPermissions(CAPS, SELF, {
    // Duplicated and mixed-case on purpose: a repeat must not bloat the policy
    // and a case difference must not read as a second address.
    withdrawalAddresses: [A, B, A, B.toUpperCase() as typeof B],
  }) as unknown as Perm[];
  const p = list.find((x) => x.target.toLowerCase() === CASH.USDT.toLowerCase() && x.functionName === "transfer");
  assert.ok(p, "registering an address grants the transfer permission");
  const [recipient, amount] = p.args as [{ condition: number; value: string[] }, { value: bigint }];
  assert.equal(recipient.condition, ParamCondition.ONE_OF);
  assert.deepEqual(recipient.value, [A, B]);
  // The amount cap still applies on top of the destination pin.
  assert.equal(amount.value, usdg(CAPS.perTradeUsdg));
});

test("every tradeable stock token can be approved, so nothing can be bought but not sold", () => {
  const tradeable = STOCK_TOKENS.filter((t) => (TRADEABLE_SYMBOLS as readonly string[]).includes(t.symbol));
  assert.ok(tradeable.length > 0, "sanity: there are tradeable tokens");
  for (const t of tradeable) {
    const [p] = find(t.address, "approve");
    assert.ok(p, `${t.symbol} must be approvable or the agent could buy it and never sell`);
    // No amount condition on purpose: share counts are 18dp and not comparable to
    // a USDG cap. Asserted so nobody "tightens" it into a broken policy.
    assert.equal((p.args as unknown[])[1], null, `${t.symbol} approve must have no amount condition`);
  }
});

test("owner-added tokens are validated and de-duplicated before becoming policy", () => {
  const builtinAddr = STOCK_TOKENS[0]!.address;
  const usable = usableExtraTokens([
    { address: builtinAddr, symbol: "DUP", decimals: 18 } as never, // already covered
    { address: "0xnothex", symbol: "BAD", decimals: 18 } as never, // malformed
    { address: "0x1111111111111111111111111111111111111111", symbol: "OK", decimals: 18 } as never,
    { address: "0x1111111111111111111111111111111111111111", symbol: "OK", decimals: 18 } as never, // repeat
  ]);
  assert.equal(usable.length, 1, "only the one valid, non-duplicate token survives");
  assert.equal(usable[0]!.symbol, "OK");
});

test("the wall carries exactly the expected permission set — no more, no less", () => {
  const list = perms();
  const stockCount = STOCK_TOKENS.filter((t) => (TRADEABLE_SYMBOLS as readonly string[]).includes(t.symbol)).length;
  // DEFAULT wall: 1 USDG approve + N stock approves + PancakeSwap SwapRouter
  // exactInputSingle. No USDG transfer — opt-in only.
  assert.equal(list.length, stockCount + 2, "an unexpected permission count means something was added or lost");
  // ...and the opt-in adds exactly one entry, never more.
  const withXfer = buildCallPermissions(CAPS, SELF, { withdrawalAddresses: [SELF] });
  assert.equal(withXfer.length, list.length + 1);
  // Nothing may authorise sending native value.
  for (const p of list) assert.equal(p.valueLimit, 0n, `${p.target} must not be allowed to move native BNB`);
});

test("policies carry a hard expiry and a daily op limit", () => {
  const now = 1_800_000_000;
  const { policies, expiresAt } = buildWallPolicies({ caps: CAPS, smartAccount: SELF, now });
  assert.equal(expiresAt, now + CAPS.expiryDays * 86_400);
  // Expiry, rate limit, call policy — the key dies on schedule even if every
  // other control fails.
  assert.equal(policies.length, 3);
});

test("the session key may EXECUTE but may not SIGN (the ERC-1271 hole)", () => {
  // Every other assertion in this file is about a CALL policy, and a call
  // policy governs UserOp calls only — it says nothing about signatures. The
  // permission validator implements signMessage and signTypedData, so on the
  // library default (FOR_ALL_VALIDATION) the session key can mint ERC-1271
  // signatures the account honours. NOT_FOR_VALIDATE_SIG stays on as standing
  // insurance even though PancakeSwap's SwapRouter itself needs no signed
  // permit — see wall.ts's WALL_POLICY_FLAG doc comment and D008.
  assert.equal(WALL_POLICY_FLAG, PolicyFlags.NOT_FOR_VALIDATE_SIG);
  assert.notEqual(
    WALL_POLICY_FLAG,
    PolicyFlags.FOR_ALL_VALIDATION,
    "the library default lets the session key sign — never ship it",
  );
});

test("the swap recipient is pinned to our own account, at the RIGHT calldata offset", () => {
  const [swap] = find(PANCAKESWAP.swapRouter, "exactInputSingle");
  assert.ok(swap);
  const args = swap.args as (null | { condition: number; value: string })[];

  // Eight entries for a ONE-parameter function, because the call policy maps
  // args[i] to calldata offset i*32 with no ABI arity check, and PancakeSwap's
  // ExactInputSingleParams is an all-static EIGHT-member tuple (it kept
  // `deadline`, which Uniswap's SwapRouter02 dropped — see D008) encoded
  // INLINE as eight consecutive words. Index 3 is `recipient`.
  assert.equal(args.length, 8);
  assert.deepEqual(args[3], { condition: ParamCondition.EQUAL, value: SELF });
  for (const i of [0, 1, 2, 4, 5, 6, 7]) assert.equal(args[i], null, `arg ${i} must stay unconstrained`);

  // AND PROVE THE OFFSET, against viem's encoder rather than against the
  // reasoning above. If PancakeSwap's struct ever gains a dynamic member or
  // reorders its fields, the inline layout shifts and args[3] would silently
  // constrain the WRONG word — a policy that looks strict and isn't. This
  // fails loudly instead.
  const OTHER = "0x00000000000000000000000000000000000000ff" as const;
  const calldata = encodeFunctionData({
    abi: PANCAKESWAP_SWAP_ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: CASH.USDT as `0x${string}`,
        tokenOut: OTHER,
        fee: 2500,
        recipient: SELF,
        deadline: 9_999_999_999n,
        amountIn: 1_000_000n,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });
  // Skip the 4-byte selector, then read word 3 (the policy's offset 3*32).
  const body = `0x${calldata.slice(10)}`;
  const word3 = `0x${body.slice(2 + 3 * 64, 2 + 4 * 64)}`;
  assert.equal(
    word3.toLowerCase(),
    pad(SELF, { size: 32 }).toLowerCase(),
    "offset 3*32 must be `recipient` — if this fails the tuple layout moved and the pin is aimed at the wrong field",
  );
});
