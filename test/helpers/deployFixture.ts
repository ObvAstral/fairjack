import { network } from "hardhat";

export const { ethers, networkHelpers } = await network.create();
export const INITIAL_TOKEN_BALANCE = ethers.parseEther("10000");
export const MAX_ORACLE_FEE = ethers.parseEther("0.001");
export const ORACLE_FUNDING = ethers.parseEther("0.1");

export async function deployFixture() {
  const [deployer, staker, player, otherPlayer, outsider] =
    await ethers.getSigners();
  const token = await ethers.deployContract("MockERC20");
  const oracle = await ethers.deployContract("MockVRFWrapper", [token.target]);
  const pool = await ethers.deployContract("FairJackPool", [
    token.target,
    oracle.target,
    MAX_ORACLE_FEE,
  ]);
  const accounts = [deployer, staker, player, otherPlayer, outsider];
  for (const account of accounts) {
    await token.mint(account.address, INITIAL_TOKEN_BALANCE);
    await token.connect(account).approve(pool.target, INITIAL_TOKEN_BALANCE);
  }
  const { chainId } = await ethers.provider.getNetwork();
  return {
    token,
    oracle,
    pool,
    deployer,
    staker,
    player,
    otherPlayer,
    outsider,
    accounts,
    chainId,
  };
}
