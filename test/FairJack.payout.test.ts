import { expect } from "chai";
import {
  INITIAL_TOKEN_BALANCE,
  networkHelpers,
} from "./helpers/deployFixture.js";
import {
  reachPlayerTurn,
  TEST_BET,
  TEST_POOL_DEPOSIT,
  TEST_VALIDATOR_COLLATERAL,
} from "./helpers/gameHelpers.js";
import {
  reachDealerWinTurn,
  reachPlayerWinTurn,
  reachPushTurn,
} from "./helpers/outcomeHelpers.js";

describe("FairJackPool payout accounting", function () {
  it("adds the bet to the pool when the player loses", async function () {
    const fixture = await networkHelpers.loadFixture(reachDealerWinTurn);

    await fixture.pool.connect(fixture.player).stand(0n);

    expect(await fixture.pool.poolBalance()).to.equal(
      TEST_POOL_DEPOSIT + TEST_BET,
    );
    expect(await fixture.token.balanceOf(fixture.player.address)).to.equal(
      INITIAL_TOKEN_BALANCE - TEST_BET,
    );
  });

  it("pays two times the bet and charges the net win to the pool", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerWinTurn);

    await fixture.pool.connect(fixture.player).stand(0n);

    expect((await fixture.pool.getGameResult(0n)).payout).to.equal(
      TEST_BET * 2n,
    );
    expect(await fixture.pool.poolBalance()).to.equal(
      TEST_POOL_DEPOSIT - TEST_BET,
    );
    expect(await fixture.token.balanceOf(fixture.player.address)).to.equal(
      INITIAL_TOKEN_BALANCE + TEST_BET,
    );
  });

  it("returns exactly the bet on push without changing pool value", async function () {
    const fixture = await networkHelpers.loadFixture(reachPushTurn);

    await fixture.pool.connect(fixture.player).stand(0n);

    expect((await fixture.pool.getGameResult(0n)).payout).to.equal(TEST_BET);
    expect(await fixture.pool.poolBalance()).to.equal(TEST_POOL_DEPOSIT);
    expect(await fixture.token.balanceOf(fixture.player.address)).to.equal(
      INITIAL_TOKEN_BALANCE,
    );
  });

  it("locks max payout at creation and releases it after settlement", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);
    expect(await fixture.pool.lockedLiquidity()).to.equal(TEST_BET * 2n);

    await fixture.pool.connect(fixture.player).stand(0n);

    expect(await fixture.pool.lockedLiquidity()).to.equal(0n);
  });

  it("prevents stakers from withdrawing locked capital", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);

    await expect(
      fixture.pool
        .connect(fixture.staker)
        .withdrawFromHousePool(TEST_POOL_DEPOSIT - TEST_BET),
    ).to.be.revertedWithCustomError(
      fixture.pool,
      "InsufficientAvailableLiquidity",
    );
  });

  it("keeps contract token balance coherent for every result", async function () {
    for (const outcomeFixture of [
      reachPlayerWinTurn,
      reachDealerWinTurn,
      reachPushTurn,
    ]) {
      const fixture = await networkHelpers.loadFixture(outcomeFixture);
      await fixture.pool.connect(fixture.player).stand(0n);

      expect(await fixture.token.balanceOf(fixture.pool.target)).to.equal(
        (await fixture.pool.poolBalance()) + TEST_VALIDATOR_COLLATERAL * 3n,
      );
    }
  });

  it("does not mint or burn shares when a game changes pool value", async function () {
    const fixture = await networkHelpers.loadFixture(reachDealerWinTurn);
    const totalSharesBefore = await fixture.pool.totalShares();
    const stakerSharesBefore = await fixture.pool.sharesOf(
      fixture.staker.address,
    );

    await fixture.pool.connect(fixture.player).stand(0n);

    expect(await fixture.pool.totalShares()).to.equal(totalSharesBefore);
    expect(await fixture.pool.sharesOf(fixture.staker.address)).to.equal(
      stakerSharesBefore,
    );
  });

  it("changes share economic value only through poolBalance", async function () {
    const fixture = await networkHelpers.loadFixture(reachDealerWinTurn);
    const sharePriceBefore = await fixture.pool.getSharePrice();

    await fixture.pool.connect(fixture.player).stand(0n);

    expect(await fixture.pool.getSharePrice()).to.be.greaterThan(
      sharePriceBefore,
    );
    expect(await fixture.pool.totalShares()).to.equal(TEST_POOL_DEPOSIT);
  });
});
