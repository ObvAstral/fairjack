import { expect } from "chai";
import { networkHelpers } from "./helpers/deployFixture.js";
import {
  findWord,
  fulfillAndProcess,
  prepareTurn,
  reachPlayerTurn,
  scoreHand,
  TEST_BET,
  TEST_POOL_DEPOSIT,
} from "./helpers/gameHelpers.js";

describe("FairJackPool gameplay", function () {
  it("allows only the player to hit or stand", async function () {
    const f = await networkHelpers.loadFixture(reachPlayerTurn);
    await expect(
      f.pool.connect(f.outsider).hit(0n),
    ).to.be.revertedWithCustomError(f.pool, "NotGamePlayer");
    await expect(
      f.pool.connect(f.outsider).stand(0n),
    ).to.be.revertedWithCustomError(f.pool, "NotGamePlayer");
  });
  it("adds one hit card and refreshes the decision deadline only after processing", async function () {
    const f = await reachPlayerTurn();
    const oldDeadline = await f.pool.getActionDeadline(0n);
    await f.pool.connect(f.player).hit(0n);
    await networkHelpers.time.increase(1000);
    const { requestId } = await f.pool.getGameRandomness(0n);
    const { word, cards } = findWord(
      f,
      0n,
      requestId,
      f.initialCards,
      1,
      (cards) => scoreHand([...f.initialCards.slice(0, 2), ...cards]) <= 21,
    );
    const { processing } = await fulfillAndProcess(f, 0n, word);
    await expect(processing)
      .to.emit(f.pool, "PlayerHit")
      .withArgs(
        0n,
        cards[0],
        BigInt(scoreHand([...f.initialCards.slice(0, 2), ...cards])),
      );
    expect(await f.pool.getActionDeadline(0n)).to.be.greaterThan(oldDeadline);
    expect(await f.pool.getPlayerCards(0n)).to.have.length(3);
  });
  it("settles a hit bust and releases both reservations once", async function () {
    const f = await reachPlayerTurn();
    await f.pool.connect(f.player).hit(0n);
    const { requestId } = await f.pool.getGameRandomness(0n);
    const { word } = findWord(
      f,
      0n,
      requestId,
      f.initialCards,
      1,
      (cards) => scoreHand([...f.initialCards.slice(0, 2), ...cards]) > 21,
    );
    await fulfillAndProcess(f, 0n, word);
    expect((await f.pool.getGameResult(0n)).result).to.equal(2n);
    expect(await f.pool.poolBalance()).to.equal(TEST_POOL_DEPOSIT + TEST_BET);
    expect(await f.pool.lockedLiquidity()).to.equal(0n);
    expect(await f.pool.lockedOracleBudget()).to.equal(0n);
    expect((await f.pool.getGameRandomness(0n)).oracleBudgetRemaining).to.equal(
      0n,
    );
    await expect(f.pool.processRandomness(0n)).to.be.revertedWithCustomError(
      f.pool,
      "InvalidGameState",
    );
    await expect(
      f.pool.connect(f.player).hit(0n),
    ).to.be.revertedWithCustomError(f.pool, "InvalidGameState");
  });
  it("requests fresh randomness after stand and resolves the whole dealer with one result", async function () {
    const f = await reachPlayerTurn();
    const initialDealer = await f.pool.getDealerCards(0n);
    await expect(f.pool.connect(f.player).stand(0n)).to.emit(
      f.pool,
      "PlayerStand",
    );
    const pending = await f.pool.getGameRandomness(0n);
    expect(pending.phase).to.equal(2n);
    expect(pending.requestCount).to.equal(2n);
    expect(await f.pool.getDealerCards(0n)).to.deep.equal(initialDealer);
    const { processing } = await fulfillAndProcess(f, 0n, 77n);
    await expect(processing)
      .to.emit(f.pool, "DealerResolved")
      .and.to.emit(f.pool, "GameFinished");
    expect(await f.pool.getDealerScore(0n)).to.be.at.least(17n);
    expect((await f.pool.getGameCore(0n)).state).to.equal(5n);
    expect((await f.pool.getGameRandomness(0n)).requestCount).to.equal(2n);
    const cards = [
      ...(await f.pool.getPlayerCards(0n)),
      ...(await f.pool.getDealerCards(0n)),
    ];
    expect(new Set(cards).size).to.equal(cards.length);
  });
  it("settles stand without an extra fee when the dealer already has 17+", async function () {
    const f = await prepareTurn((cards) => scoreHand(cards.slice(2)) >= 17);
    const reserve = await f.pool.getOracleReserve();
    await f.pool.connect(f.player).stand(0n);
    expect((await f.pool.getGameCore(0n)).state).to.equal(5n);
    expect((await f.pool.getGameRandomness(0n)).requestCount).to.equal(1n);
    expect(await f.pool.getOracleReserve()).to.equal(reserve);
  });
  it("queues stand irrevocably when the oracle is temporarily unavailable", async function () {
    const f = await reachPlayerTurn();
    await f.oracle.setRequestsEnabled(false);
    await f.pool.connect(f.player).stand(0n);
    expect((await f.pool.getGameRandomness(0n)).phase).to.equal(2n);
    await expect(
      f.pool.connect(f.player).hit(0n),
    ).to.be.revertedWithCustomError(f.pool, "InvalidGameState");
    await f.oracle.setRequestsEnabled(true);
    await f.pool.requestPendingRandomness(0n);
    await fulfillAndProcess(f);
    expect((await f.pool.getGameCore(0n)).state).to.equal(5n);
  });
});
