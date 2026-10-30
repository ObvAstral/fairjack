import { expect } from "chai";
import {
  createPool,
  fulfillAndProcess,
  resolveStand,
  TEST_BET,
  TEST_POOL_DEPOSIT,
} from "./helpers/gameHelpers.js";
import {
  INITIAL_TOKEN_BALANCE,
  ORACLE_FUNDING,
} from "./helpers/deployFixture.js";

describe("FairJack end-to-end game", function () {
  it("runs a game without validators or player-supplied oracle ETH", async function () {
    const f = await createPool();
    await f.pool.connect(f.player).startPoolGame(TEST_BET);
    await fulfillAndProcess(f, 0n, 123n);
    await f.pool.connect(f.player).hit(0n);
    await fulfillAndProcess(f, 0n, 456n);
    if ((await f.pool.getGameCore(0n)).state === 3n) await resolveStand(f);
    const outcome = await f.pool.getGameResult(0n);
    expect((await f.pool.getGameCore(0n)).state).to.equal(5n);
    let bankroll = TEST_POOL_DEPOSIT,
      balance = INITIAL_TOKEN_BALANCE;
    if (outcome.result === 1n) {
      bankroll -= TEST_BET;
      balance += TEST_BET;
    } else if (outcome.result === 2n) {
      bankroll += TEST_BET;
      balance -= TEST_BET;
    }
    expect(await f.pool.poolBalance()).to.equal(bankroll);
    expect(await f.token.balanceOf(f.player.address)).to.equal(balance);
    expect(await f.token.balanceOf(f.pool.target)).to.equal(bankroll);
    expect(await f.pool.totalShares()).to.equal(TEST_POOL_DEPOSIT);
    expect(await f.pool.lockedLiquidity()).to.equal(0n);
    expect(await f.pool.lockedOracleBudget()).to.equal(0n);
    const spent = await f.pool.totalOracleSpent();
    expect(await f.pool.getOracleReserve()).to.equal(ORACLE_FUNDING - spent);
    expect(await f.pool.getAvailableOracleReserve()).to.equal(
      ORACLE_FUNDING - spent,
    );
    const cards = [
      ...(await f.pool.getPlayerCards(0n)),
      ...(await f.pool.getDealerCards(0n)),
    ];
    expect(new Set(cards).size).to.equal(cards.length);
  });
});
