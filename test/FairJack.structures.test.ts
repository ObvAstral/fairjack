import { expect } from "chai";
import {
  deployFixture,
  ethers,
  MAX_ORACLE_FEE,
  networkHelpers,
} from "./helpers/deployFixture.js";

describe("FairJackPool configuration", function () {
  it("starts with empty token/native accounting and no games", async function () {
    const { pool, oracle, token } =
      await networkHelpers.loadFixture(deployFixture);
    expect(await pool.token()).to.equal(token.target);
    expect(await pool.vrfWrapper()).to.equal(oracle.target);
    for (const value of [
      await pool.poolBalance(),
      await pool.lockedLiquidity(),
      await pool.totalShares(),
      await pool.getOracleReserve(),
      await pool.lockedOracleBudget(),
      await pool.totalOracleSpent(),
      await pool.nextGameId(),
    ])
      expect(value).to.equal(0n);
    expect(await pool.maxOracleRequestCost()).to.equal(MAX_ORACLE_FEE);
  });
  it("has no validator, commit-reveal, owner, or oracle withdrawal API", async function () {
    const { pool } = await deployFixture();
    for (const name of [
      "registerAsValidator",
      "submitPlayerCommit",
      "revealPlayerSecret",
      "owner",
      "withdrawNative",
      "setCoordinator",
      "cancelGame",
    ])
      expect(
        new ethers.Interface(pool.interface.format()).getFunction(name),
      ).to.equal(null);
  });
  it("rejects invalid token, wrapper and fee limits", async function () {
    const { token, oracle, player, pool } = await deployFixture();
    await expect(
      ethers.deployContract("FairJackPool", [
        ethers.ZeroAddress,
        oracle.target,
        MAX_ORACLE_FEE,
      ]),
    ).to.be.revertedWithCustomError(pool, "InvalidTokenAddress");
    for (const wrapper of [ethers.ZeroAddress, player.address])
      await expect(
        ethers.deployContract("FairJackPool", [
          token.target,
          wrapper,
          MAX_ORACLE_FEE,
        ]),
      ).to.be.revertedWithCustomError(pool, "InvalidOracleAddress");
    for (const cap of [0n, ethers.MaxUint256])
      await expect(
        ethers.deployContract("FairJackPool", [
          token.target,
          oracle.target,
          cap,
        ]),
      ).to.be.revertedWithCustomError(pool, "InvalidOracleFeeLimit");
  });
  it("rejects views of nonexistent games", async function () {
    const { pool } = await deployFixture();
    await expect(pool.getGameCore(0n)).to.be.revertedWithCustomError(
      pool,
      "GameDoesNotExist",
    );
    await expect(pool.getGameRandomness(0n)).to.be.revertedWithCustomError(
      pool,
      "GameDoesNotExist",
    );
  });
});
