/**
 * Uniswap SwapRouter02 exactInputSingle — the one selector merrymen grants
 * session keys permission to call. NOTE: SwapRouter02 has NO deadline field
 * (that was SwapRouter v1). Shared by web (call policy) and worker (execution).
 */
export const UNISWAP_SWAP_ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    // Multi-hop. `path` is packed token/fee/token(/fee/token…), and the router
    // holds the intermediate leg itself — so a USDG→WETH→CATE swap still only
    // needs USDG approved. That's why routing through WETH costs no new grant
    // permission and no re-sign.
    type: "function",
    name: "exactInput",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "path", type: "bytes" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

/**
 * Permit2 — how Uniswap v4 takes tokens. The account approves Permit2 once, and
 * Permit2 grants a spender a bounded, EXPIRING allowance. `amount` is uint160 and
 * `expiration` uint48, both narrower than the usual uint256: silently truncating
 * either would grant an allowance nobody intended.
 */
export const PERMIT2_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    outputs: [],
  },
] as const;

/**
 * UniversalRouter — a command interpreter, not a swap function. `commands` is a
 * byte per operation and `inputs` the matching encoded arguments, so a call
 * policy can constrain WHICH contract runs but not what it's asked to do. The
 * real bound is upstream: it can only move what Permit2 allowed it.
 */
export const UNIVERSAL_ROUTER_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "commands", type: "bytes" },
      { name: "inputs", type: "bytes[]" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

/**
 * PancakeSwap v3 SwapRouter — the classic (non-"Smart Router") ExactInput-shaped
 * router, verified directly against `pancake-v3-contracts`' `ISwapRouter.sol`
 * on 2026-08-06 (see docs/DECISIONS.md D008). UNLIKE Uniswap's SwapRouter02,
 * PancakeSwap's version KEPT the `deadline` field — ExactInputSingleParams is
 * an 8-member tuple here, not 7. `recipient` still lands at index 3 (deadline
 * was inserted AFTER recipient, not before), which is what lets
 * packages/core/src/wall.ts pin the swap output with a call-policy arg at that
 * same offset — but the tuple arity itself must match, or the flat i*32
 * calldata-offset mapping the call policy relies on reads the wrong word
 * entirely for every arg after the insertion point.
 */
export const PANCAKESWAP_SWAP_ROUTER_ABI = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
  {
    // Multi-hop. Same deadline-retained shape: (path, recipient, deadline,
    // amountIn, amountOutMinimum) — 5 members, `path` dynamic. Not currently
    // used by the wall (single-hop only for v1); kept for the execution layer.
    type: "function",
    name: "exactInput",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "path", type: "bytes" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

/** Chainlink AggregatorV3Interface — stock feeds run 24/5; check updatedAt for staleness. */
export const CHAINLINK_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;
