import { defineChain } from "viem";

/**
 * BSC (BNB Smart Chain) constants.
 * ENTRYPOINT v07 and the INFRA addresses below were verified live on BSC
 * mainnet directly (eth_getCode / explorer lookup) in 2026-08. v06/v08 and the
 * testnet entries follow the same deterministic-deployment addresses used
 * across every EVM chain in this class — reprobe before relying on them for
 * anything security-critical.
 */

export const bscChain = defineChain({
  id: 56, // 0x38
  name: "BNB Smart Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://bsc-dataseed.binance.org"] },
  },
  blockExplorers: {
    default: {
      name: "BscScan",
      url: "https://bscscan.com",
      apiUrl: "https://api.bscscan.com/api",
    },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
});

export const bscTestnet = defineChain({
  id: 97, // 0x61
  name: "BNB Smart Chain Testnet",
  testnet: true,
  nativeCurrency: { name: "BNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://data-seed-prebsc-1-s1.binance.org:8545"] },
  },
  blockExplorers: {
    default: {
      name: "BscScan Testnet",
      url: "https://testnet.bscscan.com",
    },
  },
});

/**
 * Resolve a chain object from a grant/selector chain id. Anything that isn't
 * the testnet id is treated as mainnet — the two BSC chains are the only
 * chains this product runs on.
 */
export function chainForId(id: number): typeof bscChain | typeof bscTestnet {
  return id === bscTestnet.id ? bscTestnet : bscChain;
}

/** Block-explorer base URL for a chain id (BscScan on both chains). */
export function explorerFor(chainId: number): string {
  return chainForId(chainId).blockExplorers!.default.url;
}

/**
 * Build the Pimlico bundler RPC for a chain from just an API key. The chain id
 * is stamped from the grant itself, so the URL can never point at the wrong
 * chain — the whole class of "testnet bundler with a mainnet grant" bugs the
 * mismatch guard exists for simply cannot happen on this path.
 *
 * Unused in v0 (no wallet/session-key path yet) — kept ready for v1.
 */
export function pimlicoBundlerUrl(chainId: number, apiKey: string): string {
  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${encodeURIComponent(apiKey)}`;
}

/**
 * ERC-4337 EntryPoints. v07 confirmed deployed, verified, and actively
 * processing ZeroDev/Pimlico bundler traffic on BSC mainnet (2026-08).
 */
export const ENTRYPOINT = {
  v06: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
  v07: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  v08: "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108",
} as const;

/** Canonical infra — deterministic-deployment addresses, present on BSC mainnet 56. */
export const INFRA = {
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  create2Deployer: "0x4e59b44847b379578588920cA78FbF26c0B4956C",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
} as const;

/** Data-source identifiers. */
export const DATA = {
  geckoTerminalSlug: "bsc",
  dexScreenerChainId: "bsc",
} as const;
