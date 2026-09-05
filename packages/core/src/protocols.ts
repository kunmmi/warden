/**
 * Protocol deployments.
 *
 * PANCAKESWAP below is the live, verified BSC mainnet (56) venue — used for
 * quoting since v0 (worker/src/venues/pancakeswap-v3.ts) and, as of 2026-08-06,
 * the on-chain policy wall too (packages/core/src/wall.ts — see docs/DECISIONS.md
 * D008): its `swapRouter` is now the sole approved spender the wall grants a
 * session key.
 *
 * UNISWAP, RIALTO and MORPHO below are UNCHANGED from the Robinhood-Chain
 * (4663) fork and are WRONG addresses for BSC. wall.ts no longer references
 * them (D008), but worker/src/settings.ts's `swapVenue` config, worker/src/
 * strategies/custom.ts's sandboxed-strategy globals, worker/src/strategies/
 * registry.ts's vault reference, and worker/src/snapshot.ts's vault-balance
 * display still do — none of those offer a working BSC execution venue yet.
 * That's real, tracked scope for the next v1 step, not fixed here. DO NOT use
 * UNISWAP/RIALTO/MORPHO for anything live on BSC; use PANCAKESWAP instead.
 */

/** PancakeSwap v3 — BSC's live quoting venue (since v0) and, as of D008, the wall's sole approved router. */
export const PANCAKESWAP = {
  /** PancakeSwap V3 Factory. */
  v3Factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
  /**
   * PancakeSwap V2 Factory — where most new memecoins actually launch (the
   * classic constant-product AMM, not V3's concentrated liquidity). Verified
   * against BscScan directly, 2026-09-05. Needed for worker/src/venues/
   * pancake-discovery.ts: a V3-only "new pool" watch would miss most of them.
   */
  v2Factory: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
  /** PancakeSwap V3 QuoterV2 (contract name on-chain is "QuoterV2"). */
  v3QuoterV2: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
  /**
   * PancakeSwap V3 Swap Router — the classic ExactInput-shaped router (exactInput/
   * exactInputSingle), NOT the aggregator-style "Smart Router". Verified against
   * pancake-v3-contracts' ISwapRouter.sol source 2026-08-06 (D008) — UNLIKE
   * Uniswap's SwapRouter02, this one kept the `deadline` field, so its
   * ExactInputSingleParams is an 8-member tuple, not 7. See PANCAKESWAP_SWAP_ROUTER_ABI
   * in abis.ts and packages/core/src/wall.ts for why the exact arity matters.
   */
  swapRouter: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;

/** Uniswap — Robinhood Chain (4663) addresses. WRONG for BSC; no longer used by wall.ts (D008), still used elsewhere — see header comment above. */
export const UNISWAP = {
  universalRouter: "0x8876789976decbfcbbbe364623c63652db8c0904",
  permit2: "0x000000000022d473030f116ddee9f6b43ac78ba3",
  v4PoolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  v4PositionManager: "0x58daec3116aae6d93017baaea7749052e8a04fa7",
  v4Quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
  v4StateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  swapRouter02: "0xcaf681a66d020601342297493863e78c959e5cb2",
  v3Factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
  v3QuoterV2: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  v3PositionManager: "0x73991a25c818bf1f1128deaab1492d45638de0d3",
  v2Factory: "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f",
  v2Router02: "0x89e5db8b5aa49aa85ac63f691524311aeb649eba",
  interfaceMulticall: "0x282a3c4d320cc7f0d5eaf56b8029e4b88338f0a3",
} as const;

/** Rialto — Robinhood Chain only, no BSC equivalent. No longer used by wall.ts (D008); still referenced by worker/src/settings.ts and strategies/custom.ts. */
export const RIALTO = {
  apiBase: "https://rialto-trade-api.rialto.xyz",
  docs: "https://docs.rialto.xyz",
  routerRegistry: "0x71a120CbBf3Ce7cD910a3c50fF77aFc62735687E",
  routerSnapshot: "0xC94135b63772b91D79d0A2DaAb2a8801f32359bD",
  FEATURE_TAKER_ROUTER: 2,
  FEATURE_GASLESS_ROUTER: 3,
} as const;

/**
 * Morpho on chain 4663. NOTE: the canonical multi-chain Morpho Blue address
 * (0xBBBB...EFFCb) is EMPTY here — use the chain-specific deployment below.
 * The Morpho GraphQL API (blue-api.morpho.org/graphql) fully indexes 4663;
 * blue-sdk needs registerCustomAddresses() with these values.
 *
 * Steakhouse USDG vault is Morpho Vault V2 (ERC-4626 + ERC-2612), verified source,
 * ~$30M TVL, and PERMISSIONLESS: all four gates (receive/sendAssets, receive/
 * sendShares) verified = address(0) on-chain.
 * GOTCHA: Vault V2's ERC-4626 max* functions (maxDeposit etc.) always return 0 —
 * never gate deposit logic on them.
 *
 * Stock-token collateral markets exist (TSLA/USDG @ 77% LLTV, wSPCX/USDG) but are
 * seed-sized — not usable for real size yet.
 */
export const MORPHO = {
  morphoBlue: "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010",
  vaultV2Factory: "0x0FBad98595b0186dA120E41f77C102beb49f803c",
  registry: "0xe785a2eFD384BA7B95BaEd3851BC76aeD67C676f",
  steakhouseUsdgVault: "0xBeEff033F34C046626B8D0A041844C5d1A5409dd",
  ethenaSteakhouseUsdgVault: "0xbEeFF0fb1Dc19344A87b8479dAb60A2e16160737",
  graphqlApi: "https://blue-api.morpho.org/graphql",
} as const;
