import { expect } from "chai";
import {
  ethers,
  MAX_ORACLE_FEE,
  networkHelpers,
} from "./helpers/deployFixture.js";
import {
  createGame,
  findWord,
  fulfillAndProcess,
  reachPlayerTurn,
  TEST_BET,
} from "./helpers/gameHelpers.js";

describe("FairJackPool asynchronous VRF", function () {
  it("rejects forged callback senders", async function () {
    const f = await networkHelpers.loadFixture(createGame);
    await expect(
      f.pool.connect(f.outsider).rawFulfillRandomWords(1n, [1n]),
    ).to.be.revertedWithCustomError(f.pool, "OnlyVRFWrapperCanFulfill");
  });
  it("cannot act, process, or cancel before fulfillment", async function () {
    const f = await createGame();
    for (const action of [
      f.pool.connect(f.player).hit(0n),
      f.pool.connect(f.player).stand(0n),
      f.pool.processRandomness(0n),
    ])
      await expect(action).to.be.revertedWithCustomError(
        f.pool,
        "InvalidGameState",
      );
    await expect(f.pool.claimTimeout(0n)).to.be.revertedWithCustomError(
      f.pool,
      "TimeoutUnavailable",
    );
    await expect(
      f.pool.requestPendingRandomness(0n),
    ).to.be.revertedWithCustomError(f.pool, "NoQueuedRandomness");
  });
  it("keeps pending requests and ready results locked even after a long oracle delay", async function () {
    const f = await createGame();
    await networkHelpers.time.increase(30 * 86400);
    await expect(f.pool.claimTimeout(0n)).to.be.revertedWithCustomError(
      f.pool,
      "TimeoutUnavailable",
    );
    await f.oracle.fulfillRandomWords(1n, 42n);
    await networkHelpers.time.increase(86400);
    await expect(f.pool.claimTimeout(0n)).to.be.revertedWithCustomError(
      f.pool,
      "TimeoutUnavailable",
    );
    await f.pool.processRandomness(0n);
    const latest = await ethers.provider.getBlock("latest");
    if (!latest) throw new Error("Missing latest block");
    expect(await f.pool.getActionDeadline(0n)).to.equal(
      BigInt(latest.timestamp) + 300n,
    );
  });
  it("accepts a zero word and ignores unknown, malformed and duplicate responses", async function () {
    const f = await createGame();
    await f.oracle.deliverForTest(f.pool.target, 999n, [1n]);
    await f.oracle.deliverForTest(f.pool.target, 1n, []);
    await f.oracle.deliverForTest(f.pool.target, 1n, [1n, 2n]);
    expect((await f.pool.getGameCore(0n)).state).to.equal(1n);
    await f.oracle.fulfillRandomWords(1n, 0n);
    await f.oracle.deliverForTest(f.pool.target, 1n, [999n]);
    expect((await f.pool.randomnessRequests(1n)).randomWord).to.equal(0n);
    await f.pool.processRandomness(0n);
    const hand = await f.pool.getPlayerCards(0n);
    await f.oracle.deliverForTest(f.pool.target, 1n, [99n]);
    expect(await f.pool.getPlayerCards(0n)).to.deep.equal(hand);
    await expect(f.pool.processRandomness(0n)).to.be.revertedWithCustomError(
      f.pool,
      "InvalidGameState",
    );
  });
  it("matches out-of-order responses to the correct concurrent game, including game zero", async function () {
    const f = await createGame();
    await f.pool.connect(f.otherPlayer).startPoolGame(TEST_BET);
    const a = await f.pool.getGameRandomness(0n),
      b = await f.pool.getGameRandomness(1n);
    await f.oracle.fulfillRandomWords(b.requestId, 777n);
    expect((await f.pool.getGameCore(0n)).state).to.equal(1n);
    expect((await f.pool.getGameCore(1n)).state).to.equal(2n);
    await f.oracle.fulfillRandomWords(a.requestId, 777n);
    await f.pool.processRandomness(1n);
    await f.pool.processRandomness(0n);
    expect(await f.pool.getPlayerCards(1n)).not.to.deep.equal(
      await f.pool.getPlayerCards(0n),
    );
    expect((await f.pool.randomnessRequests(a.requestId)).gameId).to.equal(0n);
    expect((await f.pool.randomnessRequests(b.requestId)).gameId).to.equal(1n);
    const ga = await f.pool.getGameRandomness(0n),
      gb = await f.pool.getGameRandomness(1n);
    expect(await f.pool.lockedOracleBudget()).to.equal(
      ga.oracleBudgetRemaining + gb.oracleBudgetRemaining,
    );
  });
  it("requires a fresh request for each hit, blocks action changes and ignores stale responses", async function () {
    const f = await networkHelpers.loadFixture(reachPlayerTurn);
    const before = await f.pool.getGameRandomness(0n);
    const oldHand = await f.pool.getPlayerCards(0n);
    const reserve = await f.pool.getOracleReserve();
    await f.pool.connect(f.player).hit(0n);
    const after = await f.pool.getGameRandomness(0n);
    expect(after.requestId).not.to.equal(before.requestId);
    expect(after.phase).to.equal(1n);
    expect(after.requestCount).to.equal(2n);
    expect(await f.pool.getOracleReserve()).to.equal(
      reserve - (await f.oracle.fee()),
    );
    expect(await f.pool.getPlayerCards(0n)).to.deep.equal(oldHand);
    expect(await f.pool.getActionDeadline(0n)).to.equal(0n);
    await expect(
      f.pool.connect(f.player).stand(0n),
    ).to.be.revertedWithCustomError(f.pool, "InvalidGameState");
    await expect(
      f.pool.connect(f.player).hit(0n),
    ).to.be.revertedWithCustomError(f.pool, "InvalidGameState");
    await f.oracle.deliverForTest(f.pool.target, before.requestId, [123n]);
    expect((await f.pool.getGameCore(0n)).state).to.equal(1n);
    await fulfillAndProcess(f, 0n, 0n);
    expect(await f.pool.getPlayerCards(0n)).to.have.length(3);
  });
  for (const failure of ["fee", "outage"])
    it(`queues a committed hit during ${failure}, without a player timeout or reroll`, async function () {
      const f = await reachPlayerTurn();
      const old = await f.pool.getGameRandomness(0n);
      if (failure === "fee") await f.oracle.setFee(MAX_ORACLE_FEE + 1n);
      else await f.oracle.setRequestsEnabled(false);
      await expect(f.pool.connect(f.player).hit(0n))
        .to.emit(f.pool, "OracleRequestDeferred")
        .withArgs(0n, 1n);
      const pending = await f.pool.getGameRandomness(0n);
      expect(pending.queued).to.equal(true);
      expect(pending.fulfilled).to.equal(false);
      expect(pending.oracleSpent).to.equal(old.oracleSpent);
      expect(pending.requestCount).to.equal(old.requestCount);
      await networkHelpers.time.increase(1000);
      await expect(f.pool.claimTimeout(0n)).to.be.revertedWithCustomError(
        f.pool,
        "TimeoutUnavailable",
      );
      await expect(
        f.pool.requestPendingRandomness(0n),
      ).to.be.revertedWithCustomError(f.pool, "OracleUnavailable");
      await f.oracle.setFee(MAX_ORACLE_FEE);
      await f.oracle.setRequestsEnabled(true);
      await f.pool.connect(f.outsider).requestPendingRandomness(0n);
      expect((await f.pool.getGameRandomness(0n)).queued).to.equal(false);
      expect((await f.pool.getGameRandomness(0n)).requestCount).to.equal(
        old.requestCount + 1n,
      );
      await expect(
        f.pool.requestPendingRandomness(0n),
      ).to.be.revertedWithCustomError(f.pool, "NoQueuedRandomness");
      await fulfillAndProcess(f);
      expect(await f.pool.getPlayerCards(0n)).to.have.length(3);
    });
  it("allows multiple sequential hits only after consuming each fresh result", async function () {
    const f = await reachPlayerTurn();
    for (let i = 0; i < 2; ++i) {
      const p = [...(await f.pool.getPlayerCards(0n))],
        d = [...(await f.pool.getDealerCards(0n))];
      const seen = [...p.slice(0, 2), ...d, ...p.slice(2)];
      await f.pool.connect(f.player).hit(0n);
      const { requestId } = await f.pool.getGameRandomness(0n);
      const { word } = findWord(
        f,
        0n,
        requestId,
        seen,
        1,
        (cards) => Number(cards[0]) % 13 === 0,
      );
      await fulfillAndProcess(f, 0n, word);
    }
    expect(await f.pool.getPlayerCards(0n)).to.have.length(4);
    expect((await f.pool.getGameRandomness(0n)).requestCount).to.equal(3n);
  });
});
