import { expect } from "chai";
import {
  ethers,
  INITIAL_TOKEN_BALANCE,
  networkHelpers,
} from "./helpers/deployFixture.js";
import {
  reachPlayerTurn,
  TEST_BET,
  TEST_POOL_DEPOSIT,
} from "./helpers/gameHelpers.js";

describe("FairJackPool player deadlines", function () {
  it("rejects a premature timeout and keeps the exact deadline open", async function () {
    const f = await networkHelpers.loadFixture(reachPlayerTurn);
    const deadline = await f.pool.getActionDeadline(0n);
    await expect(f.pool.claimTimeout(0n)).to.be.revertedWithCustomError(
      f.pool,
      "GameDeadlineNotReached",
    );
    await networkHelpers.time.increaseTo(deadline);
    await expect(f.pool.claimTimeout.staticCall(0n))
      .to.be.revertedWithCustomError(f.pool, "GameDeadlineNotReached")
      .withArgs(deadline, deadline);
    await expect(f.pool.connect(f.player).hit.staticCall(0n)).not.to.revert(
      ethers,
    );
  });
  it("rejects player actions after their deadline", async function () {
    const f = await reachPlayerTurn();
    await networkHelpers.time.increaseTo(
      (await f.pool.getActionDeadline(0n)) + 1n,
    );
    await expect(
      f.pool.connect(f.player).hit(0n),
    ).to.be.revertedWithCustomError(f.pool, "GameDeadlinePassed");
    await expect(
      f.pool.connect(f.player).stand(0n),
    ).to.be.revertedWithCustomError(f.pool, "GameDeadlinePassed");
  });
  it("anyone can settle inactivity as a loss, releasing native and token reservations once", async function () {
    const f = await reachPlayerTurn();
    const spent = (await f.pool.getGameRandomness(0n)).oracleSpent;
    const native = await f.pool.getOracleReserve();
    await networkHelpers.time.increaseTo(
      (await f.pool.getActionDeadline(0n)) + 1n,
    );
    await expect(f.pool.connect(f.outsider).claimTimeout(0n))
      .to.emit(f.pool, "PlayerPenalized")
      .withArgs(0n, f.player.address, TEST_BET);
    expect((await f.pool.getGameResult(0n)).result).to.equal(2n);
    expect(await f.pool.poolBalance()).to.equal(TEST_POOL_DEPOSIT + TEST_BET);
    expect(await f.token.balanceOf(f.player.address)).to.equal(
      INITIAL_TOKEN_BALANCE - TEST_BET,
    );
    expect(await f.pool.lockedLiquidity()).to.equal(0n);
    expect(await f.pool.lockedOracleBudget()).to.equal(0n);
    expect(await f.pool.getAvailableOracleReserve()).to.equal(native);
    expect(await f.pool.totalOracleSpent()).to.equal(spent);
    await expect(f.pool.claimTimeout(0n)).to.be.revertedWithCustomError(
      f.pool,
      "TimeoutUnavailable",
    );
  });
  it("does not allow stakers to withdraw a pending game's payout", async function () {
    const f = await reachPlayerTurn();
    await f.pool.connect(f.player).hit(0n);
    await expect(
      f.pool
        .connect(f.staker)
        .withdrawFromHousePool(TEST_POOL_DEPOSIT - TEST_BET),
    ).to.be.revertedWithCustomError(f.pool, "InsufficientAvailableLiquidity");
    expect(await ethers.provider.getBalance(f.pool.target)).to.be.greaterThan(
      0n,
    );
  });
});
