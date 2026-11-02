import { expect } from "chai";
import {
  chainTimestamp,
  syncChainClock,
  type ChainClock,
} from "../frontend/src/utils/chainClock.js";
import { formatDuration } from "../frontend/src/utils/format.js";
import { ethers, networkHelpers } from "./helpers/deployFixture.js";
import { reachPlayerTurn } from "./helpers/gameHelpers.js";

describe("FairJack frontend chain clock", function () {
  it("counts down past five minutes while polling the same block every four seconds", function () {
    const block = { hash: "turn-block", timestamp: 1000 };
    const loadedAt = 100;
    const deadline = block.timestamp + 300;
    let clock = syncChainClock(null, block, loadedAt);

    expect(formatDuration(deadline - chainTimestamp(clock, loadedAt))).to.equal(
      "5:00",
    );
    expect(
      formatDuration(deadline - chainTimestamp(clock, loadedAt + 2000)),
    ).to.equal("4:58");
    for (let elapsed = 4000; elapsed <= 304000; elapsed += 4000) {
      clock = syncChainClock(clock, { ...block }, loadedAt + elapsed);
      expect(chainTimestamp(clock, loadedAt + elapsed)).to.equal(
        block.timestamp + elapsed / 1000,
      );
    }
    expect(chainTimestamp(clock, loadedAt + 300000)).to.equal(deadline);
    expect(chainTimestamp(clock, loadedAt + 301000)).to.equal(deadline + 1);
  });

  it("synchronizes to a newly mined block, including local time jumps", function () {
    let clock = syncChainClock(null, { hash: "old", timestamp: 1000 }, 0);
    clock = syncChainClock(clock, { hash: "new", timestamp: 1600 }, 4000);

    expect(chainTimestamp(clock, 4000)).to.equal(1600);
    expect(chainTimestamp(clock, 6000)).to.equal(1602);
    clock = syncChainClock(clock, { hash: "new", timestamp: 1600 }, 8000);
    expect(chainTimestamp(clock, 8000)).to.equal(1604);
  });

  it("resynchronizes after the local chain is reset to an earlier timestamp", function () {
    const clock = syncChainClock(
      syncChainClock(null, { hash: "old", timestamp: 2000 }, 0),
      { hash: "reset", timestamp: 1000 },
      4000,
    );
    expect(chainTimestamp(clock, 4000)).to.equal(1000);
  });

  it("handles the initial render and a timer tick older than the latest synchronization", function () {
    expect(chainTimestamp(null, 1000)).to.equal(0);
    const clock = syncChainClock(null, { hash: "block", timestamp: 1000 }, 2000);
    expect(chainTimestamp(clock, 1000)).to.equal(1000);
  });

  it("keeps the on-chain deadline fixed while idle and settles when the next block passes it", async function () {
    const f = await networkHelpers.loadFixture(reachPlayerTurn);
    const block = await ethers.provider.getBlock("latest");
    if (!block) throw new Error("Missing player-turn block");
    const deadline = await f.pool.getActionDeadline(0n);
    expect(deadline).to.equal(BigInt(block.timestamp) + 300n);
    let clock: ChainClock | null = null;

    for (let elapsed = 0; elapsed <= 304000; elapsed += 4000) {
      const latest = await ethers.provider.getBlock("latest");
      if (!latest) throw new Error("Missing latest block");
      clock = syncChainClock(clock, latest, elapsed);
      expect(chainTimestamp(clock, elapsed)).to.equal(
        block.timestamp + elapsed / 1000,
      );
    }
    expect(await f.pool.getActionDeadline(0n)).to.equal(deadline);
    expect((await ethers.provider.getBlock("latest"))?.hash).to.equal(block.hash);
    expect(BigInt(chainTimestamp(clock, 300000))).to.equal(deadline);
    expect(BigInt(chainTimestamp(clock, 301000))).to.be.greaterThan(deadline);

    // Simulate wall time passing without mining an intermediate block.
    await networkHelpers.time.setNextBlockTimestamp(deadline + 1n);
    await expect(f.pool.connect(f.outsider).claimTimeout(0n))
      .to.emit(f.pool, "TimeoutClaimed")
      .withArgs(0n, f.outsider.address, 3n);
    expect((await f.pool.getGameResult(0n)).result).to.equal(2n);
    expect(await f.pool.getActionDeadline(0n)).to.equal(0n);
  });
});
