import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-viem";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  // Deploy targets (deployment itself waits for a funded key):
  // BSC testnet 97 / mainnet 56.
  networks: {
    bscTestnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
    },
    bsc: {
      url: "https://bsc-dataseed.binance.org",
      chainId: 56,
    },
  },
};

export default config;
