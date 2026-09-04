import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseUnits } from "viem";

const SUPPLY = parseUnits("1000000000", 18);

async function deploy() {
  const [deployer, stranger] = await hre.viem.getWalletClients();
  const token = await hre.viem.deployContract("WardenToken", [deployer.account.address, SUPPLY]);
  const publicClient = await hre.viem.getPublicClient();
  return { deployer, stranger, token, publicClient };
}

describe("WardenToken", () => {
  it("mints the entire fixed supply to the deployer and nowhere else", async () => {
    const { deployer, token } = await deploy();
    expect(await token.read.totalSupply()).to.equal(SUPPLY);
    expect(await token.read.balanceOf([deployer.account.address])).to.equal(SUPPLY);
    expect(await token.read.name()).to.equal("Warden");
    expect(await token.read.symbol()).to.equal("WARDEN");
    expect(await token.read.decimals()).to.equal(18);
  });

  it("transfers normally between holders, no fee, no blacklist", async () => {
    const { deployer, stranger, token } = await deploy();
    const amount = parseUnits("1000", 18);
    await token.write.transfer([stranger.account.address, amount], { account: deployer.account });
    expect(await token.read.balanceOf([stranger.account.address])).to.equal(amount);
    expect(await token.read.balanceOf([deployer.account.address])).to.equal(SUPPLY - amount);
  });

  it("exposes no owner-only or admin functions — the ABI is plain ERC20", async () => {
    const { token } = await deploy();
    const names = token.abi
      .filter((f): f is Extract<typeof f, { type: "function" }> => f.type === "function")
      .map((f) => f.name);
    // A handful of surprising names would signal a hidden admin/mint/pause hook.
    for (const dangerous of ["mint", "burn", "pause", "blacklist", "setFee", "renounceOwnership", "owner"]) {
      expect(names).to.not.include(dangerous);
    }
  });

  it("a stranger cannot move funds they don't hold", async () => {
    const { stranger, token } = await deploy();
    let reverted = false;
    try {
      await token.write.transfer([stranger.account.address, 1n], { account: stranger.account });
    } catch {
      reverted = true;
    }
    expect(reverted).to.equal(true);
  });
});
