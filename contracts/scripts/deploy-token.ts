/**
 * Deploys WardenToken with the entire fixed supply minted to the deployer's
 * own address. Run this yourself, from your own funded key — it's a real,
 * irreversible mainnet transaction, so it isn't wired into any automated
 * flow here.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-token.ts --network bscTestnet
 *   DEPLOYER_PRIVATE_KEY=0x... npx hardhat run scripts/deploy-token.ts --network bsc
 *
 * TOTAL_SUPPLY (whole tokens, no decimals) defaults to 1,000,000,000.
 */
import hre from "hardhat";
import { createWalletClient, http, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet, bsc } from "viem/chains";

async function main() {
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) throw new Error("Set DEPLOYER_PRIVATE_KEY (0x-prefixed) in the environment before running this.");

  const totalSupplyWhole = process.env.TOTAL_SUPPLY ?? "1000000000";
  const totalSupply = parseUnits(totalSupplyWhole, 18);

  const networkName = hre.network.name;
  const chain = networkName === "bsc" ? bsc : bscTestnet;
  const account = privateKeyToAccount(pk as `0x${string}`);
  const wallet = createWalletClient({ account, chain, transport: http(hre.network.config.url as string) });

  console.log(`Deploying WardenToken to ${networkName} (chain ${chain.id}) from ${account.address}`);
  console.log(`Total supply: ${totalSupplyWhole} WARDEN, all minted to ${account.address}`);

  const token = await hre.viem.deployContract("WardenToken", [account.address, totalSupply], {
    walletClient: wallet,
  });

  console.log(`\nWardenToken deployed: ${token.address}`);
  const publicClient = await hre.viem.getPublicClient();
  const balance = await publicClient.readContract({
    address: token.address,
    abi: token.abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`Deployer balance: ${formatUnits(balance as bigint, 18)} WARDEN`);
  console.log(`\nNext: verify the source on BscScan, then add PancakeSwap liquidity yourself.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
