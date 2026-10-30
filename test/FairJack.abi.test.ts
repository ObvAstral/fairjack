import { expect } from "chai";
import { fairJackPoolAbi } from "../frontend/src/contracts/abis.js";
import { ethers } from "./helpers/deployFixture.js";

describe("FairJack frontend ABI integration", function () {
  it("preserves named outputs and event fields consumed by the frontend", function () {
    const abi = new ethers.Interface(fairJackPoolAbi);
    const player = "0x0000000000000000000000000000000000000001";
    const core = abi.decodeFunctionResult(
      "getGameCore",
      abi.encodeFunctionResult("getGameCore", [player, 25n, 50n, 1]),
    );
    expect(core.player).to.equal(player);
    expect(core.state).to.equal(1n);
    const randomness = abi.decodeFunctionResult(
      "getGameRandomness",
      abi.encodeFunctionResult("getGameRandomness", [
        99n,
        0,
        1n,
        false,
        false,
        100n,
        1100n,
        false,
      ]),
    );
    expect(randomness.requestId).to.equal(99n);
    expect(randomness.oracleBudgetRemaining).to.equal(1100n);
    expect(randomness.queued).to.equal(false);
    const event = abi.getEvent("PoolGameStarted");
    if (!event) throw new Error("PoolGameStarted ABI missing");
    const log = abi.encodeEventLog(event, [7n, player, 25n, 50n]);
    expect(abi.parseLog(log)?.args.gameId).to.equal(7n);
  });
});
