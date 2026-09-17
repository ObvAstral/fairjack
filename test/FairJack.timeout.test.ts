import { expect } from "chai";
import { createCommit, createSecret } from "./helpers/cryptoHelpers.js";
import {
  INITIAL_TOKEN_BALANCE,
  networkHelpers,
} from "./helpers/deployFixture.js";
import {
  createGame,
  reachPlayerTurn,
  submitAllCommits,
  TEST_BET,
  TEST_POOL_DEPOSIT,
  TEST_VALIDATOR_COLLATERAL,
} from "./helpers/gameHelpers.js";

const GAME_ID = 0n;

async function movePast(deadline: bigint) {
  await networkHelpers.time.increaseTo(Number(deadline + 1n));
}

describe("FairJackPool deadlines and slashing", function () {
  it("does not allow a timeout claim before the current deadline", async function () {
    const fixture = await networkHelpers.loadFixture(createGame);

    await expect(
      fixture.pool.connect(fixture.outsider).claimTimeout(GAME_ID),
    ).to.be.revertedWithCustomError(
      fixture.pool,
      "GameDeadlineNotReached",
    );
  });

  it("keeps the phase open through the exact deadline timestamp", async function () {
    const fixture = await networkHelpers.loadFixture(createGame);
    const deadline = (await fixture.pool.getGameDeadlines(GAME_ID))
      .commitDeadline;
    await networkHelpers.time.increaseTo(Number(deadline));

    await expect(
      fixture.pool
        .connect(fixture.outsider)
        .claimTimeout.staticCall(GAME_ID),
    )
      .to.be.revertedWithCustomError(
        fixture.pool,
        "GameDeadlineNotReached",
      )
      .withArgs(deadline, deadline);
  });

  it("rejects commit and reveal submissions after their deadlines", async function () {
    const commitFixture = await networkHelpers.loadFixture(createGame);
    const commitDeadline = (
      await commitFixture.pool.getGameDeadlines(GAME_ID)
    ).commitDeadline;
    await movePast(commitDeadline);

    await expect(
      commitFixture.pool
        .connect(commitFixture.player)
        .submitPlayerCommit(GAME_ID, createSecret()),
    ).to.be.revertedWithCustomError(
      commitFixture.pool,
      "GameDeadlinePassed",
    );

    const revealFixture = await networkHelpers.loadFixture(submitAllCommits);
    const revealDeadline = (
      await revealFixture.pool.getGameDeadlines(GAME_ID)
    ).revealDeadline;
    await movePast(revealDeadline);

    await expect(
      revealFixture.pool
        .connect(revealFixture.player)
        .revealPlayerSecret(GAME_ID, revealFixture.playerSecret),
    ).to.be.revertedWithCustomError(
      revealFixture.pool,
      "GameDeadlinePassed",
    );
  });

  it("slashes a validator that misses the commit deadline and refunds the player", async function () {
    const fixture = await networkHelpers.loadFixture(createGame);
    const contractAddress = await fixture.pool.getAddress();
    const missingValidator = fixture.committeeSigners[2];

    await fixture.pool
      .connect(fixture.player)
      .submitPlayerCommit(
        GAME_ID,
        createCommit(
          createSecret(),
          GAME_ID,
          fixture.player.address,
          contractAddress,
        ),
      );
    for (const validator of fixture.committeeSigners.slice(0, 2)) {
      await fixture.pool
        .connect(validator)
        .submitValidatorCommit(
          GAME_ID,
          createCommit(
            createSecret(),
            GAME_ID,
            validator.address,
            contractAddress,
          ),
        );
    }

    const deadline = (await fixture.pool.getGameDeadlines(GAME_ID))
      .commitDeadline;
    await movePast(deadline);

    await expect(
      fixture.pool.connect(fixture.outsider).claimTimeout(GAME_ID),
    )
      .to.emit(fixture.pool, "ValidatorSlashed")
      .withArgs(
        GAME_ID,
        missingValidator.address,
        await fixture.pool.VALIDATOR_SLASH_AMOUNT(),
      )
      .and.to.emit(fixture.pool, "GameCancelled")
      .withArgs(GAME_ID)
      .and.to.emit(fixture.pool, "TimeoutClaimed")
      .withArgs(GAME_ID, fixture.outsider.address, 1n);

    const game = await fixture.pool.getGameCore(GAME_ID);
    const result = await fixture.pool.getGameResult(GAME_ID);
    const missingInfo = await fixture.pool.validators(
      missingValidator.address,
    );
    expect(game.state).to.equal(6n);
    expect(result.result).to.equal(0n);
    expect(result.payout).to.equal(TEST_BET);
    expect(missingInfo.collateral).to.equal(
      TEST_VALIDATOR_COLLATERAL -
        (await fixture.pool.VALIDATOR_SLASH_AMOUNT()),
    );
    expect(missingInfo.slashCount).to.equal(1n);
    expect(await fixture.pool.poolBalance()).to.equal(
      TEST_POOL_DEPOSIT + (await fixture.pool.VALIDATOR_SLASH_AMOUNT()),
    );
    expect(await fixture.token.balanceOf(fixture.player.address)).to.equal(
      INITIAL_TOKEN_BALANCE,
    );
    expect(await fixture.pool.lockedLiquidity()).to.equal(0n);
    for (const validator of fixture.committee) {
      expect(
        (await fixture.pool.validators(validator)).activeGames,
      ).to.equal(0n);
    }
  });

  it("penalizes a player that misses the commit deadline without slashing honest validators", async function () {
    const fixture = await networkHelpers.loadFixture(createGame);
    const contractAddress = await fixture.pool.getAddress();

    for (const validator of fixture.committeeSigners) {
      await fixture.pool
        .connect(validator)
        .submitValidatorCommit(
          GAME_ID,
          createCommit(
            createSecret(),
            GAME_ID,
            validator.address,
            contractAddress,
          ),
        );
    }

    const deadline = (await fixture.pool.getGameDeadlines(GAME_ID))
      .commitDeadline;
    await movePast(deadline);

    await expect(
      fixture.pool.connect(fixture.outsider).claimTimeout(GAME_ID),
    )
      .to.emit(fixture.pool, "PlayerPenalized")
      .withArgs(GAME_ID, fixture.player.address, TEST_BET)
      .and.to.emit(fixture.pool, "GameCancelled");

    expect((await fixture.pool.getGameCore(GAME_ID)).state).to.equal(6n);
    expect((await fixture.pool.getGameResult(GAME_ID)).payout).to.equal(0n);
    expect(await fixture.pool.poolBalance()).to.equal(
      TEST_POOL_DEPOSIT + TEST_BET,
    );
    expect(await fixture.token.balanceOf(fixture.player.address)).to.equal(
      INITIAL_TOKEN_BALANCE - TEST_BET,
    );
    for (const validator of fixture.committee) {
      const info = await fixture.pool.validators(validator);
      expect(info.collateral).to.equal(TEST_VALIDATOR_COLLATERAL);
      expect(info.activeGames).to.equal(0n);
      expect(info.slashCount).to.equal(0n);
    }
  });

  it("slashes a validator that withholds its reveal and refunds an honest player", async function () {
    const fixture = await networkHelpers.loadFixture(submitAllCommits);
    const missingValidator = fixture.committeeSigners[2];

    await fixture.pool
      .connect(fixture.player)
      .revealPlayerSecret(GAME_ID, fixture.playerSecret);
    for (let index = 0; index < 2; ++index) {
      await fixture.pool
        .connect(fixture.committeeSigners[index])
        .revealValidatorSecret(GAME_ID, fixture.validatorSecrets[index]);
    }

    const deadline = (await fixture.pool.getGameDeadlines(GAME_ID))
      .revealDeadline;
    await movePast(deadline);

    await expect(
      fixture.pool.connect(fixture.outsider).claimTimeout(GAME_ID),
    )
      .to.emit(fixture.pool, "ValidatorSlashed")
      .withArgs(
        GAME_ID,
        missingValidator.address,
        await fixture.pool.VALIDATOR_SLASH_AMOUNT(),
      )
      .and.to.emit(fixture.pool, "GameCancelled");

    expect((await fixture.pool.getGameCore(GAME_ID)).state).to.equal(6n);
    expect((await fixture.pool.getGameResult(GAME_ID)).payout).to.equal(
      TEST_BET,
    );
    expect(await fixture.token.balanceOf(fixture.player.address)).to.equal(
      INITIAL_TOKEN_BALANCE,
    );
    expect(
      (await fixture.pool.validators(missingValidator.address)).slashCount,
    ).to.equal(1n);
  });

  it("penalizes a player that withholds its reveal", async function () {
    const fixture = await networkHelpers.loadFixture(submitAllCommits);

    for (let index = 0; index < fixture.committeeSigners.length; ++index) {
      await fixture.pool
        .connect(fixture.committeeSigners[index])
        .revealValidatorSecret(GAME_ID, fixture.validatorSecrets[index]);
    }

    const deadline = (await fixture.pool.getGameDeadlines(GAME_ID))
      .revealDeadline;
    await movePast(deadline);
    await fixture.pool.connect(fixture.outsider).claimTimeout(GAME_ID);

    expect((await fixture.pool.getGameCore(GAME_ID)).state).to.equal(6n);
    expect((await fixture.pool.getGameResult(GAME_ID)).payout).to.equal(0n);
    expect(await fixture.pool.poolBalance()).to.equal(
      TEST_POOL_DEPOSIT + TEST_BET,
    );
    for (const validator of fixture.committee) {
      const info = await fixture.pool.validators(validator);
      expect(info.collateral).to.equal(TEST_VALIDATOR_COLLATERAL);
      expect(info.slashCount).to.equal(0n);
    }
  });

  it("settles an inactive player as a loss after the action deadline", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);
    const deadline = (await fixture.pool.getGameDeadlines(GAME_ID))
      .actionDeadline;
    await movePast(deadline);

    await expect(
      fixture.pool.connect(fixture.outsider).claimTimeout(GAME_ID),
    )
      .to.emit(fixture.pool, "TimeoutClaimed")
      .withArgs(GAME_ID, fixture.outsider.address, 3n)
      .and.to.emit(fixture.pool, "PlayerPenalized")
      .withArgs(GAME_ID, fixture.player.address, TEST_BET)
      .and.to.emit(fixture.pool, "GameFinished");

    const game = await fixture.pool.getGameCore(GAME_ID);
    const result = await fixture.pool.getGameResult(GAME_ID);
    expect(game.state).to.equal(5n);
    expect(result.result).to.equal(2n);
    expect(result.payout).to.equal(0n);
    expect(await fixture.pool.poolBalance()).to.equal(
      TEST_POOL_DEPOSIT + TEST_BET,
    );
    expect(await fixture.pool.lockedLiquidity()).to.equal(0n);
    for (const validator of fixture.committee) {
      expect(
        (await fixture.pool.validators(validator)).activeGames,
      ).to.equal(0n);
    }
  });

  it("cannot claim the same timeout twice", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);
    const deadline = (await fixture.pool.getGameDeadlines(GAME_ID))
      .actionDeadline;
    await movePast(deadline);
    await fixture.pool.connect(fixture.outsider).claimTimeout(GAME_ID);

    await expect(
      fixture.pool.connect(fixture.outsider).claimTimeout(GAME_ID),
    ).to.be.revertedWithCustomError(fixture.pool, "TimeoutUnavailable");
  });
});
