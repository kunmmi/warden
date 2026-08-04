/**
 * Protocol deployments.
 *
 * PANCAKESWAP below is the live, verified BSC mainnet (56) quoting venue for
 * v0 — see worker/src/venues/pancakeswap-v3.ts.
 *
 * UNISWAP, RIALTO and MORPHO below are UNCHANGED from the Robinhood-Chain
 * (4663) fork and are WRONG addresses for BSC. They're kept only because
 * packages/core/src/wall.ts (the on-chain policy wall) and its tests still
 * reference them, and porting the wall to PancakeSwap v3 + BSC is explicitly
 * deferred to v1 (see the Warden build plan) — v0 has no wallet/session-key
 * path, so the wall is never exercised against real addresses yet. DO NOT use
 * UNISWAP/RIALTO for anything live on BSC; use PANCAKESWAP instead.
 */

/** PancakeSwap v3 — the read-only quoting venue for v0 (see pancakeswap-v3.ts). */
export const PANCAKESWAP = {
  /** PancakeSwap V3 Factory. */
  v3Factory: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865",
  /** PancakeSwap V3 QuoterV2 (contract name on-chain is "QuoterV2"). */
  v3QuoterV2: "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997",
  /**
   * PancakeSwap V3 Swap Router — the SwapRouter02-shaped router (exactInput/
   * exactInputSingle), NOT the aggregator-style "Smart Router". v0 only quotes
   * (no execution), so this is unused today but kept for the v1 execution path.
   */
  swapRouter: "0x1b81D678ffb9C0263b24A97847620C99d213eB14",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
} as const;

/** Uniswap — Robinhood Chain (4663) addresses. WRONG for BSC; wall.ts-only, v1 work. */
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

/** Rialto — Robinhood Chain only, no BSC equivalent. wall.ts-only, v1 work. */
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
