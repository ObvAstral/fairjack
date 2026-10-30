import { expect } from "chai";
import {
  deployFixture,
  ethers,
  MAX_ORACLE_FEE,
  networkHelpers,
  ORACLE_FUNDING,
} from "./helpers/deployFixture.js";
import {
  createGame,
  findWord,
  fulfillAndProcess,
  prepareTurn,
  scoreHand,
  TEST_BET,
  TEST_POOL_DEPOSIT,
} from "./helpers/gameHelpers.js";

describe("FairJack asynchronous accounting safety", function () {
  it("freezes share trading while any game exposes the pool to an unresolved outcome", async function () {
    const f = await createGame();
    await expect(
      f.pool.connect(f.staker).withdrawFromHousePool(1n),
    ).to.be.revertedWithCustomError(f.pool, "ActiveGamesPreventShareChanges");
    await expect(
      f.pool.connect(f.otherPlayer).depositToHousePool(TEST_BET),
    ).to.be.revertedWithCustomError(f.pool, "ActiveGamesPreventShareChanges");
    await fulfillAndProcess(f);
    await networkHelpers.time.increaseTo(
      (await f.pool.getActionDeadline(0n)) + 1n,
    );
    await f.pool.claimTimeout(0n);
    await f.pool.connect(f.otherPlayer).depositToHousePool(TEST_BET);
    await f.pool.connect(f.staker).withdrawFromHousePool(1n);
  });
  it("keeps other games' token and native locks when settling one concurrent game", async function () {
    const f = await prepareTurn(
      (cards) =>
        scoreHand(cards.slice(0, 2)) === 20 && scoreHand(cards.slice(2)) === 17,
    );
    await f.pool.connect(f.otherPlayer).startPoolGame(TEST_BET);
    const second = await f.pool.getGameRandomness(1n);
    await f.pool.connect(f.player).stand(0n);
    expect(await f.pool.lockedLiquidity()).to.equal(TEST_BET * 2n);
    expect(await f.pool.lockedOracleBudget()).to.equal(
      second.oracleBudgetRemaining,
    );
    expect((await f.pool.getGameCore(1n)).state).to.equal(1n);
  });
  it("stores the VRF response even if payout processing temporarily reverts", async function () {
    const base = await deployFixture();
    const token = await ethers.deployContract("SettlementTestToken");
    const pool = await ethers.deployContract("FairJackPool", [
      token.target,
      base.oracle.target,
      MAX_ORACLE_FEE,
    ]);
    const f = { ...base, token, pool };
    await token.mint(f.staker.address, TEST_POOL_DEPOSIT);
    await token.connect(f.staker).approve(pool.target, ethers.MaxUint256);
    await pool.connect(f.staker).depositToHousePool(TEST_POOL_DEPOSIT);
    await token.mint(f.player.address, TEST_BET);
    await token.connect(f.player).approve(pool.target, ethers.MaxUint256);
    await pool.fundOracle({ value: ORACLE_FUNDING });
    await pool.connect(f.player).startPoolGame(TEST_BET);
    const initial = await pool.getGameRandomness(0n);
    const { word } = findWord(
      f,
      0n,
      initial.requestId,
      [],
      4,
      (cards) =>
        scoreHand(cards.slice(0, 2)) === 21 && scoreHand(cards.slice(2)) < 17,
    );
    await f.oracle.fulfillRandomWords(initial.requestId, word);
    await pool.processRandomness(0n);
    await pool.connect(f.player).stand(0n);
    const pending = await pool.getGameRandomness(0n);
    await token.setTransfersBlocked(true);
    await expect(f.oracle.fulfillRandomWords(pending.requestId, 123n))
      .to.emit(f.oracle, "MockFulfilled")
      .withArgs(pending.requestId, true);
    const spent = await pool.totalOracleSpent();
    await expect(pool.processRandomness(0n)).to.be.revertedWithCustomError(
      token,
      "TransfersBlocked",
    );
    expect((await pool.getGameCore(0n)).state).to.equal(2n);
    expect((await pool.getGameRandomness(0n)).consumed).to.equal(false);
    expect(await pool.lockedLiquidity()).to.equal(TEST_BET * 2n);
    expect(
      (await pool.randomnessRequests(pending.requestId)).randomWord,
    ).to.equal(123n);
    await token.setTransfersBlocked(false);
    await pool.connect(f.outsider).processRandomness(0n);
    expect((await pool.getGameCore(0n)).state).to.equal(5n);
    expect(await pool.totalOracleSpent()).to.equal(spent);
    expect(await pool.lockedOracleBudget()).to.equal(0n);
  });
});
