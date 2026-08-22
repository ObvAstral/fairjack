import { expect } from "chai";
import {
  ethers,
  INITIAL_TOKEN_BALANCE,
  networkHelpers,
} from "./helpers/deployFixture.js";
import {
  reachPlayerTurn,
  submitAllCommits,
  TEST_BET,
  TEST_POOL_DEPOSIT,
  TEST_VALIDATOR_COLLATERAL,
} from "./helpers/gameHelpers.js";

describe("FairJackPool initial deal", function () {
  function deriveCards(seed: string, count: number): bigint[] {
    const cards: bigint[] = [];
    const drawn = new Set<number>();
    let nonce = 0n;

    while (cards.length < count) {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256"],
        [seed, nonce],
      );
      const card = Number(BigInt(ethers.keccak256(encoded)) % 52n);
      ++nonce;
      if (!drawn.has(card)) {
        drawn.add(card);
        cards.push(BigInt(card));
      }
    }

    return cards;
  }

  it("deals two player cards and two dealer cards after the final reveal", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);

    expect(await fixture.pool.getPlayerCards(0n)).to.have.length(2);
    expect(await fixture.pool.getDealerCards(0n)).to.have.length(2);
    expect((await fixture.pool.getGameCore(0n)).state).to.equal(3n);
  });

  it("deals the exact deterministic sequence without duplicates", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);
    const progress = await fixture.pool.getGameRandomnessProgress(0n);
    const expected = deriveCards(progress.finalSeed, 4);
    const playerCards = await fixture.pool.getPlayerCards(0n);
    const dealerCards = await fixture.pool.getDealerCards(0n);

    expect(playerCards).to.deep.equal(expected.slice(0, 2));
    expect(dealerCards).to.deep.equal(expected.slice(2, 4));
    expect(
      new Set([...playerCards, ...dealerCards].map(Number)).size,
    ).to.equal(4);
  });

  it("sets the action deadline and emits game/card events", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);
    const playerCards = await fixture.pool.getPlayerCards(0n);

    expect((await fixture.pool.getGameDeadlines(0n)).actionDeadline).to.be
      .greaterThan(0n);
    await expect(fixture.lastRevealTransaction)
      .to.emit(fixture.pool, "GameStarted")
      .withArgs(0n, fixture.player.address);
    await expect(fixture.lastRevealTransaction)
      .to.emit(fixture.pool, "CardDrawn")
      .withArgs(0n, true, playerCards[0], 1n);
  });

  it("preserves pool, lock, bet, and validator accounting during the deal", async function () {
    const fixture = await networkHelpers.loadFixture(reachPlayerTurn);

    expect(await fixture.pool.poolBalance()).to.equal(TEST_POOL_DEPOSIT);
    expect(await fixture.pool.lockedLiquidity()).to.equal(TEST_BET * 2n);
    expect(await fixture.pool.totalShares()).to.equal(TEST_POOL_DEPOSIT);
    expect(await fixture.token.balanceOf(fixture.pool.target)).to.equal(
      TEST_POOL_DEPOSIT + TEST_VALIDATOR_COLLATERAL * 3n + TEST_BET,
    );
    expect(await fixture.token.balanceOf(fixture.player.address)).to.equal(
      INITIAL_TOKEN_BALANCE - TEST_BET,
    );
    for (const validator of fixture.committee) {
      expect(
        (await fixture.pool.validators(validator)).activeGames,
      ).to.equal(1n);
    }
  });

  it("deals identical hands when reveal transaction order changes", async function () {
    const fixture = await networkHelpers.loadFixture(submitAllCommits);
    const snapshot = await networkHelpers.takeSnapshot();

    await fixture.pool
      .connect(fixture.player)
      .revealPlayerSecret(0n, fixture.playerSecret);
    for (let index = 0; index < fixture.committeeSigners.length; ++index) {
      await fixture.pool
        .connect(fixture.committeeSigners[index])
        .revealValidatorSecret(0n, fixture.validatorSecrets[index]);
    }
    const firstPlayerHand = await fixture.pool.getPlayerCards(0n);
    const firstDealerHand = await fixture.pool.getDealerCards(0n);

    await snapshot.restore();
    for (const index of [2, 0, 1]) {
      await fixture.pool
        .connect(fixture.committeeSigners[index])
        .revealValidatorSecret(0n, fixture.validatorSecrets[index]);
    }
    await fixture.pool
      .connect(fixture.player)
      .revealPlayerSecret(0n, fixture.playerSecret);

    expect(await fixture.pool.getPlayerCards(0n)).to.deep.equal(
      firstPlayerHand,
    );
    expect(await fixture.pool.getDealerCards(0n)).to.deep.equal(
      firstDealerHand,
    );
  });
});
