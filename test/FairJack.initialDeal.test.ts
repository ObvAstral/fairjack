import { expect } from "chai";
import { ethers, networkHelpers } from "./helpers/deployFixture.js";
import {
  createGame,
  drawPhase,
  fulfillAndProcess,
  TEST_BET,
  TEST_POOL_DEPOSIT,
} from "./helpers/gameHelpers.js";

describe("FairJackPool initial deal", function () {
  it("waits for the oracle and then deals four unique cards on permissionless processing", async function () {
    const f = await networkHelpers.loadFixture(createGame);
    expect(await f.pool.getPlayerCards(0n)).to.have.length(0);
    const { requestId } = await f.pool.getGameRandomness(0n);
    await expect(f.oracle.fulfillRandomWords(requestId, 0n))
      .to.emit(f.oracle, "MockFulfilled")
      .withArgs(requestId, true);
    expect((await f.pool.getGameCore(0n)).state).to.equal(2n);
    expect(await f.pool.getPlayerCards(0n)).to.have.length(0);
    const expected = drawPhase(f, 0n, requestId, 0n, [], 4);
    const tx = await f.pool.connect(f.outsider).processRandomness(0n);
    await expect(tx)
      .to.emit(f.pool, "GameStarted")
      .withArgs(0n, f.player.address);
    expect(await f.pool.getPlayerCards(0n)).to.deep.equal(expected.slice(0, 2));
    expect(await f.pool.getDealerCards(0n)).to.deep.equal(expected.slice(2));
    expect(new Set(expected).size).to.equal(4);
    expect((await f.pool.getGameCore(0n)).state).to.equal(3n);
    expect((await f.pool.getGameRandomness(0n)).consumed).to.equal(true);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Missing transaction receipt");
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    if (!block) throw new Error("Missing processing block");
    expect(await f.pool.getActionDeadline(0n)).to.equal(
      BigInt(block.timestamp) + 300n,
    );
  });
  it("does not change share or bankroll accounting while delivering cards", async function () {
    const f = await createGame();
    const nativeBalance = await f.pool.getOracleReserve();
    await fulfillAndProcess(f);
    expect(await f.pool.poolBalance()).to.equal(TEST_POOL_DEPOSIT);
    expect(await f.pool.totalShares()).to.equal(TEST_POOL_DEPOSIT);
    expect(await f.pool.lockedLiquidity()).to.equal(TEST_BET * 2n);
    expect(await f.pool.getOracleReserve()).to.equal(nativeBalance);
    expect(await f.pool.getCardsDrawn(0n)).to.equal(4n);
  });
});
