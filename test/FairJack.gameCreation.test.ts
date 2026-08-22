import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const MIN_COLLATERAL = ethers.parseEther("100");
const INITIAL_BALANCE = ethers.parseEther("10000");
const POOL_DEPOSIT = ethers.parseEther("1000");
const BET = ethers.parseEther("25");

describe("FairJackPool game creation", function () {
  async function deployReadyPoolFixture() {
    const [staker, player, validatorA, validatorB, validatorC] =
      await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20");
    const pool = await ethers.deployContract("FairJackPool", [token.target]);

    for (const account of [
      staker,
      player,
      validatorA,
      validatorB,
      validatorC,
    ]) {
      await token.mint(account.address, INITIAL_BALANCE);
      await token.connect(account).approve(pool.target, INITIAL_BALANCE);
    }

    await pool.connect(staker).depositToHousePool(POOL_DEPOSIT);
    for (const validator of [validatorA, validatorB, validatorC]) {
      await pool.connect(validator).registerAsValidator(MIN_COLLATERAL);
    }

    return {
      token,
      pool,
      staker,
      player,
      validatorA,
      validatorB,
      validatorC,
    };
  }

  it("creates a game separately from the player commit", async function () {
    const { pool, player } =
      await networkHelpers.loadFixture(deployReadyPoolFixture);

    await expect(pool.connect(player).startPoolGame(BET))
      .to.emit(pool, "PoolGameStarted")
      .withArgs(0n, player.address, BET, BET * 2n);

    const game = await pool.getGameCore(0n);
    expect(game.player).to.equal(player.address);
    expect(game.bet).to.equal(BET);
    expect(game.maxPayout).to.equal(BET * 2n);
    expect(game.state).to.equal(1n); // WaitingForCommits
    expect(await pool.nextGameId()).to.equal(1n);
  });

  it("transfers the bet without treating it as pool profit", async function () {
    const { token, pool, player } =
      await networkHelpers.loadFixture(deployReadyPoolFixture);
    const validatorCollateral = MIN_COLLATERAL * 3n;

    await pool.connect(player).startPoolGame(BET);

    expect(await token.balanceOf(player.address)).to.equal(
      INITIAL_BALANCE - BET,
    );
    expect(await token.balanceOf(pool.target)).to.equal(
      POOL_DEPOSIT + validatorCollateral + BET,
    );
    expect(await pool.poolBalance()).to.equal(POOL_DEPOSIT);
    expect(await pool.totalShares()).to.equal(POOL_DEPOSIT);
  });

  it("locks exactly the maximum payout against pool liquidity", async function () {
    const { pool, player } =
      await networkHelpers.loadFixture(deployReadyPoolFixture);

    await pool.connect(player).startPoolGame(BET);

    expect(await pool.lockedLiquidity()).to.equal(BET * 2n);
    expect(await pool.getAvailableLiquidity()).to.equal(
      POOL_DEPOSIT - BET * 2n,
    );
  });

  it("selects and reserves three distinct validators", async function () {
    const { pool, player } =
      await networkHelpers.loadFixture(deployReadyPoolFixture);

    await pool.connect(player).startPoolGame(BET);
    const committee = await pool.getGameValidators(0n);

    expect(new Set(committee).size).to.equal(3);
    expect(committee).not.to.include(player.address);
    for (const validator of committee) {
      const info = await pool.validators(validator);
      expect(info.registered).to.equal(true);
      expect(info.activeGames).to.equal(1n);
    }
  });

  it("initializes only the deadline for the current commit phase", async function () {
    const { pool, player } =
      await networkHelpers.loadFixture(deployReadyPoolFixture);
    const before = BigInt(await networkHelpers.time.latest());

    await pool.connect(player).startPoolGame(BET);

    const deadlines = await pool.getGameDeadlines(0n);
    expect(deadlines.commitDeadline).to.be.greaterThan(before);
    expect(deadlines.revealDeadline).to.equal(0n);
    expect(deadlines.actionDeadline).to.equal(0n);
  });

  it("rejects bets below the minimum", async function () {
    const { pool, player } =
      await networkHelpers.loadFixture(deployReadyPoolFixture);

    await expect(
      pool.connect(player).startPoolGame(ethers.parseEther("1") - 1n),
    ).to.be.revertedWithCustomError(pool, "BetBelowMinimum");
  });

  it("rejects bets above the maximum", async function () {
    const { pool, player } =
      await networkHelpers.loadFixture(deployReadyPoolFixture);

    await expect(
      pool.connect(player).startPoolGame(ethers.parseEther("100") + 1n),
    ).to.be.revertedWithCustomError(pool, "BetAboveMaximum");
  });

  it("rejects a bet without sufficient allowance", async function () {
    const { token, pool, player } =
      await networkHelpers.loadFixture(deployReadyPoolFixture);
    await token.connect(player).approve(pool.target, BET - 1n);

    await expect(
      pool.connect(player).startPoolGame(BET),
    ).to.be.revertedWithCustomError(pool, "InsufficientTokenAllowance");
  });

  it("reverts every accounting change if liquidity cannot cover max payout", async function () {
    const { token, pool, staker, player } =
      await networkHelpers.loadFixture(deployReadyPoolFixture);
    await pool.connect(staker).withdrawFromHousePool(POOL_DEPOSIT);
    const playerBalanceBefore = await token.balanceOf(player.address);
    const contractBalanceBefore = await token.balanceOf(pool.target);

    await expect(
      pool.connect(player).startPoolGame(BET),
    ).to.be.revertedWithCustomError(pool, "InsufficientAvailableLiquidity");

    expect(await token.balanceOf(player.address)).to.equal(playerBalanceBefore);
    expect(await token.balanceOf(pool.target)).to.equal(contractBalanceBefore);
    expect(await pool.lockedLiquidity()).to.equal(0n);
    expect(await pool.nextGameId()).to.equal(0n);
  });

  it("reverts the bet and lock if a full eligible committee is unavailable", async function () {
    const { token, pool, player, validatorA } =
      await networkHelpers.loadFixture(deployReadyPoolFixture);
    await pool.connect(validatorA).unregisterAsValidator();
    const playerBalanceBefore = await token.balanceOf(player.address);

    await expect(
      pool.connect(player).startPoolGame(BET),
    ).to.be.revertedWithCustomError(pool, "InsufficientEligibleValidators");

    expect(await token.balanceOf(player.address)).to.equal(playerBalanceBefore);
    expect(await pool.lockedLiquidity()).to.equal(0n);
    expect(await pool.nextGameId()).to.equal(0n);
  });
});
