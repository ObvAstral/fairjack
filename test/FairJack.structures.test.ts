import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("FairJackPool data structures", function () {
  async function deployPool() {
    const token = await ethers.deployContract("MockERC20");
    const pool = await ethers.deployContract("FairJackPool", [token.target]);

    return { token, pool };
  }

  it("starts with empty pool accounting", async function () {
    const { pool } = await deployPool();

    expect(await pool.poolBalance()).to.equal(0n);
    expect(await pool.lockedLiquidity()).to.equal(0n);
    expect(await pool.totalShares()).to.equal(0n);
  });

  it("starts with an empty validator registry", async function () {
    const { pool } = await deployPool();
    const [account] = await ethers.getSigners();

    expect(await pool.getValidatorCount()).to.equal(0n);
    expect(await pool.validators(account.address)).to.deep.equal([
      false,
      0n,
      0n,
      0n,
    ]);
  });

  it("starts without allocated game identifiers", async function () {
    const { pool } = await deployPool();

    expect(await pool.nextGameId()).to.equal(0n);
  });
});
