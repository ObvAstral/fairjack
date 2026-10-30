import { expect } from "chai";
import {
  deployFixture,
  ethers,
  INITIAL_TOKEN_BALANCE,
  MAX_ORACLE_FEE,
  networkHelpers,
  ORACLE_FUNDING,
} from "./helpers/deployFixture.js";
import {
  createPool,
  TEST_BET,
  TEST_POOL_DEPOSIT,
} from "./helpers/gameHelpers.js";

describe("FairJackPool game creation and oracle treasury", function () {
  it("accepts native donations from anyone without minting token shares", async function () {
    const { pool, outsider, token } =
      await networkHelpers.loadFixture(deployFixture);
    await expect(pool.connect(outsider).fundOracle({ value: 100n }))
      .to.emit(pool, "OracleReserveFunded")
      .withArgs(outsider.address, 100n);
    await outsider.sendTransaction({ to: pool.target, value: 50n });
    expect(await pool.getOracleReserve()).to.equal(150n);
    expect(await pool.totalOracleFunded()).to.equal(150n);
    expect(await pool.getAvailableOracleReserve()).to.equal(150n);
    expect(await pool.totalShares()).to.equal(0n);
    expect(await pool.poolBalance()).to.equal(0n);
    expect(await token.balanceOf(pool.target)).to.equal(0n);
    await expect(pool.fundOracle()).to.be.revertedWithCustomError(
      pool,
      "ZeroAmount",
    );
  });
  it("locks the payout and a complete native budget, paying VRF from the pool", async function () {
    const f = await networkHelpers.loadFixture(createPool);
    const fee = await f.oracle.fee();
    const tx = await f.pool.connect(f.player).startPoolGame(TEST_BET);
    await expect(tx)
      .to.emit(f.pool, "PoolGameStarted")
      .withArgs(0n, f.player.address, TEST_BET, TEST_BET * 2n);
    await expect(tx).to.changeEtherBalances(
      ethers,
      [f.pool, f.oracle],
      [-fee, fee],
    );
    const progress = await f.pool.getGameRandomness(0n);
    const budget = await f.pool.getRequiredOracleBudget();
    expect((await f.pool.getGameCore(0n)).state).to.equal(1n);
    expect(progress.requestId).to.equal(1n);
    expect(progress.phase).to.equal(0n);
    expect(progress.requestCount).to.equal(1n);
    expect(progress.oracleSpent).to.equal(fee);
    expect(progress.oracleBudgetRemaining).to.equal(budget - fee);
    expect(await f.pool.lockedOracleBudget()).to.equal(budget - fee);
    expect(await f.pool.getAvailableOracleReserve()).to.equal(
      ORACLE_FUNDING - budget,
    );
    expect(await f.pool.lockedLiquidity()).to.equal(TEST_BET * 2n);
    expect(await f.pool.getActionDeadline(0n)).to.equal(0n);
    expect(await f.pool.poolBalance()).to.equal(TEST_POOL_DEPOSIT);
    expect(await f.token.balanceOf(f.player.address)).to.equal(
      INITIAL_TOKEN_BALANCE - TEST_BET,
    );
    expect(await f.token.balanceOf(f.pool.target)).to.equal(
      TEST_POOL_DEPOSIT + TEST_BET,
    );
  });
  it("does not accept an oracle fee attached by the player", async function () {
    const f = await createPool();
    await expect(
      f.player.sendTransaction({
        to: f.pool.target,
        data: f.pool.interface.encodeFunctionData("startPoolGame", [TEST_BET]),
        value: 1n,
      }),
    ).to.revert(ethers);
    expect(await f.pool.nextGameId()).to.equal(0n);
  });
  it("rejects bets outside the limits and missing allowance", async function () {
    const f = await createPool();
    await expect(
      f.pool.connect(f.player).startPoolGame(0n),
    ).to.be.revertedWithCustomError(f.pool, "BetBelowMinimum");
    await expect(
      f.pool.connect(f.player).startPoolGame(ethers.parseEther("101")),
    ).to.be.revertedWithCustomError(f.pool, "BetAboveMaximum");
    await f.token.connect(f.player).approve(f.pool.target, 0n);
    await expect(
      f.pool.connect(f.player).startPoolGame(TEST_BET),
    ).to.be.revertedWithCustomError(f.pool, "InsufficientTokenAllowance");
  });
  it("rolls back a start without payout liquidity or native reserve", async function () {
    const f = await deployFixture();
    await expect(
      f.pool.connect(f.player).startPoolGame(TEST_BET),
    ).to.be.revertedWithCustomError(f.pool, "InsufficientAvailableLiquidity");
    await f.pool.connect(f.staker).depositToHousePool(TEST_POOL_DEPOSIT);
    await expect(
      f.pool.connect(f.player).startPoolGame(TEST_BET),
    ).to.be.revertedWithCustomError(f.pool, "InsufficientOracleReserve");
    expect(await f.pool.nextGameId()).to.equal(0n);
    expect(await f.token.balanceOf(f.player.address)).to.equal(
      INITIAL_TOKEN_BALANCE,
    );
    expect(await f.pool.lockedLiquidity()).to.equal(0n);
  });
  it("cannot spend another active game's oracle reservation", async function () {
    const f = await deployFixture();
    await f.pool.connect(f.staker).depositToHousePool(TEST_POOL_DEPOSIT);
    const budget = await f.pool.getRequiredOracleBudget();
    await f.pool.fundOracle({ value: budget });
    await f.pool.connect(f.player).startPoolGame(TEST_BET);
    await expect(
      f.pool.connect(f.otherPlayer).startPoolGame(TEST_BET),
    ).to.be.revertedWithCustomError(f.pool, "InsufficientOracleReserve");
    expect(await f.pool.nextGameId()).to.equal(1n);
    expect(await f.pool.getAvailableOracleReserve()).to.equal(0n);
  });
  for (const failure of ["fee", "outage"])
    it(`rolls back a new game during oracle ${failure}`, async function () {
      const f = await createPool();
      if (failure === "fee") await f.oracle.setFee(MAX_ORACLE_FEE + 1n);
      else await f.oracle.setRequestsEnabled(false);
      await expect(
        f.pool.connect(f.player).startPoolGame(TEST_BET),
      ).to.be.revertedWithCustomError(f.pool, "OracleUnavailable");
      expect(await f.token.balanceOf(f.player.address)).to.equal(
        INITIAL_TOKEN_BALANCE,
      );
      expect(await f.pool.getOracleReserve()).to.equal(ORACLE_FUNDING);
      expect(await f.pool.lockedOracleBudget()).to.equal(0n);
      expect(await f.pool.totalOracleSpent()).to.equal(0n);
      expect(await f.pool.nextGameId()).to.equal(0n);
    });
});
