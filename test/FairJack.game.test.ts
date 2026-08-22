import { expect } from "chai";
import {
  ethers,
  INITIAL_TOKEN_BALANCE,
  networkHelpers,
} from "./helpers/deployFixture.js";
import {
  createGame,
  reachPlayerTurn,
  TEST_BET,
  TEST_POOL_DEPOSIT,
  TEST_VALIDATOR_COLLATERAL,
} from "./helpers/gameHelpers.js";
import {
  reachDealerBustTurn,
  reachDealerWinTurn,
  reachPlayerWinTurn,
  reachPushTurn,
} from "./helpers/outcomeHelpers.js";

describe("FairJackPool gameplay", function () {
  it("integrates game creation, liquidity lock, committee, and initial deal", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);
    const committee = await fixture.pool.getGameValidators(0n);
    const allCards = [
      ...(await fixture.pool.getPlayerCards(0n)),
      ...(await fixture.pool.getDealerCards(0n)),
    ];

    expect((await fixture.pool.getGameCore(0n)).player).to.equal(
      fixture.player.address,
    );
    expect(await fixture.pool.lockedLiquidity()).to.equal(TEST_BET * 2n);
    expect(new Set(committee).size).to.equal(3);
    expect(allCards).to.have.length(4);
    expect(new Set(allCards.map(Number)).size).to.equal(4);
  });
  it("adds one deterministic card on hit and refreshes the action deadline", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);
    const cardsBefore = await fixture.pool.getPlayerCards(0n);
    const deadlineBefore = (await fixture.pool.getGameDeadlines(0n))
      .actionDeadline;

    await expect(fixture.pool.connect(fixture.player).hit(0n)).to.emit(
      fixture.pool,
      "PlayerHit",
    );

    const cardsAfter = await fixture.pool.getPlayerCards(0n);
    expect(cardsAfter).to.have.length(cardsBefore.length + 1);
    expect(cardsAfter.slice(0, cardsBefore.length)).to.deep.equal(cardsBefore);
    const state = (await fixture.pool.getGameCore(0n)).state;
    if (state === 3n) {
      expect(
        (await fixture.pool.getGameDeadlines(0n)).actionDeadline,
      ).to.be.greaterThan(deadlineBefore);
    }
  });

  it("allows only the player to hit or stand", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);

    await expect(
      fixture.pool.connect(fixture.outsider).hit(0n),
    ).to.be.revertedWithCustomError(fixture.pool, "NotGamePlayer");
    await expect(
      fixture.pool.connect(fixture.outsider).stand(0n),
    ).to.be.revertedWithCustomError(fixture.pool, "NotGamePlayer");
  });

  it("rejects actions before PlayerTurn", async function () {
    const fixture = await networkHelpers.loadFixture(createGame);

    await expect(
      fixture.pool.connect(fixture.player).hit(0n),
    ).to.be.revertedWithCustomError(fixture.pool, "InvalidGameState");
    await expect(
      fixture.pool.connect(fixture.player).stand(0n),
    ).to.be.revertedWithCustomError(fixture.pool, "InvalidGameState");
  });

  it("rejects player actions after the action deadline", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);
    const deadline = (await fixture.pool.getGameDeadlines(0n)).actionDeadline;
    await networkHelpers.time.increaseTo(Number(deadline + 1n));

    await expect(
      fixture.pool.connect(fixture.player).hit(0n),
    ).to.be.revertedWithCustomError(fixture.pool, "GameDeadlinePassed");
    await expect(
      fixture.pool.connect(fixture.player).stand(0n),
    ).to.be.revertedWithCustomError(fixture.pool, "GameDeadlinePassed");
  });

  it("settles a player bust through the same accounting path", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);

    while ((await fixture.pool.getGameCore(0n)).state === 3n) {
      await fixture.pool.connect(fixture.player).hit(0n);
    }

    expect(await fixture.pool.getPlayerScore(0n)).to.be.greaterThan(21n);
    expect((await fixture.pool.getGameResult(0n)).result).to.equal(2n);
    expect(await fixture.pool.poolBalance()).to.equal(
      TEST_POOL_DEPOSIT + TEST_BET,
    );
    expect(await fixture.pool.lockedLiquidity()).to.equal(0n);
    expect(await fixture.token.balanceOf(fixture.player.address)).to.equal(
      INITIAL_TOKEN_BALANCE - TEST_BET,
    );
  });

  it("runs the automatic dealer to 17 or higher after stand", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);

    await expect(fixture.pool.connect(fixture.player).stand(0n))
      .to.emit(fixture.pool, "PlayerStand")
      .and.to.emit(fixture.pool, "DealerResolved")
      .and.to.emit(fixture.pool, "GameFinished");

    const dealerCards = await fixture.pool.getDealerCards(0n);
    const dealerScore = await fixture.pool.getDealerScore(0n);
    expect(dealerScore).to.be.greaterThanOrEqual(17n);
    for (let length = 2; length < dealerCards.length; ++length) {
      const prefix = dealerCards.slice(0, length);
      let score = 0;
      let aces = 0;
      for (const rawCard of prefix) {
        const rank = Number(rawCard) % 13;
        if (rank === 0) {
          score += 11;
          ++aces;
        } else if (rank >= 9) {
          score += 10;
        } else {
          score += rank + 1;
        }
      }
      while (score > 21 && aces > 0) {
        score -= 10;
        --aces;
      }
      expect(score).to.be.lessThan(17);
    }
  });

  it("resolves a dealer bust as a player win", async function () {
    const fixture = await networkHelpers.loadFixture(reachDealerBustTurn);
    await fixture.pool.connect(fixture.player).stand(0n);

    expect(await fixture.pool.getDealerScore(0n)).to.be.greaterThan(21n);
    expect((await fixture.pool.getGameResult(0n)).result).to.equal(1n);
  });

  it("resolves a higher non-bust player score as a player win", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerWinTurn);
    await fixture.pool.connect(fixture.player).stand(0n);

    expect(await fixture.pool.getPlayerScore(0n)).to.be.greaterThan(
      await fixture.pool.getDealerScore(0n),
    );
    expect((await fixture.pool.getGameResult(0n)).result).to.equal(1n);
  });

  it("resolves a higher dealer score as a dealer win", async function () {
    const fixture = await networkHelpers.loadFixture(reachDealerWinTurn);
    await fixture.pool.connect(fixture.player).stand(0n);

    expect(await fixture.pool.getDealerScore(0n)).to.be.greaterThan(
      await fixture.pool.getPlayerScore(0n),
    );
    expect((await fixture.pool.getGameResult(0n)).result).to.equal(2n);
  });

  it("resolves equal scores as a push", async function () {
    const fixture = await networkHelpers.loadFixture(reachPushTurn);
    await fixture.pool.connect(fixture.player).stand(0n);

    expect(await fixture.pool.getPlayerScore(0n)).to.equal(
      await fixture.pool.getDealerScore(0n),
    );
    expect((await fixture.pool.getGameResult(0n)).result).to.equal(3n);
  });

  it("settles stand consistently across token, pool, shares, and validators", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);
    await fixture.pool.connect(fixture.player).stand(0n);

    const game = await fixture.pool.getGameCore(0n);
    const outcome = await fixture.pool.getGameResult(0n);
    expect(game.state).to.equal(5n);
    expect(await fixture.pool.lockedLiquidity()).to.equal(0n);
    expect(await fixture.pool.totalShares()).to.equal(TEST_POOL_DEPOSIT);

    let expectedPoolBalance = TEST_POOL_DEPOSIT;
    let expectedPlayerBalance = INITIAL_TOKEN_BALANCE;
    if (outcome.result === 1n) {
      expectedPoolBalance -= TEST_BET;
      expectedPlayerBalance += TEST_BET;
      expect(outcome.payout).to.equal(TEST_BET * 2n);
    } else if (outcome.result === 2n) {
      expectedPoolBalance += TEST_BET;
      expectedPlayerBalance -= TEST_BET;
      expect(outcome.payout).to.equal(0n);
    } else {
      expect(outcome.result).to.equal(3n);
      expect(outcome.payout).to.equal(TEST_BET);
    }

    expect(await fixture.pool.poolBalance()).to.equal(expectedPoolBalance);
    expect(await fixture.token.balanceOf(fixture.player.address)).to.equal(
      expectedPlayerBalance,
    );
    expect(await fixture.token.balanceOf(fixture.pool.target)).to.equal(
      expectedPoolBalance + TEST_VALIDATOR_COLLATERAL * 3n,
    );
    for (const validator of fixture.committee) {
      expect(
        (await fixture.pool.validators(validator)).activeGames,
      ).to.equal(0n);
    }
  });

  it("cannot settle or act twice", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);
    await fixture.pool.connect(fixture.player).stand(0n);

    await expect(
      fixture.pool.connect(fixture.player).stand(0n),
    ).to.be.revertedWithCustomError(fixture.pool, "InvalidGameState");
    await expect(
      fixture.pool.connect(fixture.player).hit(0n),
    ).to.be.revertedWithCustomError(fixture.pool, "InvalidGameState");
  });

  it("keeps locked pool capital unavailable until settlement", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);
    const sharesRequiringLockedFunds = ethers.parseEther("975");

    await expect(
      fixture.pool
        .connect(fixture.staker)
        .withdrawFromHousePool(sharesRequiringLockedFunds),
    ).to.be.revertedWithCustomError(
      fixture.pool,
      "InsufficientAvailableLiquidity",
    );

    await fixture.pool.connect(fixture.player).stand(0n);
    expect(await fixture.pool.lockedLiquidity()).to.equal(0n);
  });
});
