import { network } from "hardhat";

export const { ethers, networkHelpers } = await network.create();

export const INITIAL_TOKEN_BALANCE = ethers.parseEther("10000");

export async function deployFixture() {
  const [deployer, staker, player, validatorA, validatorB, validatorC, outsider] =
    await ethers.getSigners();
  const token = await ethers.deployContract("MockERC20");
  const pool = await ethers.deployContract("FairJackPool", [token.target]);
  const accounts = [
    deployer,
    staker,
    player,
    validatorA,
    validatorB,
    validatorC,
    outsider,
  ];

  for (const account of accounts) {
    await token.mint(account.address, INITIAL_TOKEN_BALANCE);
    await token.connect(account).approve(pool.target, INITIAL_TOKEN_BALANCE);
  }

  return {
    token,
    pool,
    deployer,
    staker,
    player,
    validatorA,
    validatorB,
    validatorC,
    outsider,
    accounts,
  };
}
