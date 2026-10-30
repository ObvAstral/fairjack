import { expect } from "chai";
import { ethers } from "./helpers/deployFixture.js";

// Exercise the actual Chainlink wrapper and native-payment ABI, not only our mock.
describe("FairJack official Chainlink wrapper integration", function () {
  it("pays the official wrapper and receives its authenticated coordinator callback", async function () {
    const [staker, player, processor] = await ethers.getSigners();
    const link = await ethers.deployContract("LinkToken");
    const feed = await ethers.deployContract("MockV3Aggregator", [
      18,
      ethers.parseEther("0.005"),
    ]);
    const coordinator = await ethers.deployContract("VRFCoordinatorV2_5Mock", [
      ethers.parseEther("0.001"),
      1_000_000_000n,
      ethers.parseEther("0.005"),
    ]);
    const receipt = await (await coordinator.createSubscription()).wait();
    const created = receipt?.logs
      .map((log) => {
        try {
          return coordinator.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((event) => event?.name === "SubscriptionCreated");
    if (!created) throw new Error("Subscription creation event missing");
    const subId = created.args.subId;
    await coordinator.fundSubscriptionWithNative(subId, {
      value: ethers.parseEther("5"),
    });
    const wrapper = await ethers.deployContract("VRFV2PlusWrapper", [
      link.target,
      feed.target,
      coordinator.target,
      subId,
    ]);
    await coordinator.addConsumer(subId, wrapper.target);
    await wrapper.setConfig(
      13400,
      90000,
      112000,
      435,
      24,
      20,
      ethers.id("test gas lane"),
      1,
      86400,
      ethers.parseEther("0.005"),
      0,
      0,
    );
    const token = await ethers.deployContract("MockERC20");
    const pool = await ethers.deployContract("FairJackPool", [
      token.target,
      wrapper.target,
      ethers.parseEther("0.005"),
    ]);
    await token.mint(staker.address, ethers.parseEther("1000"));
    await token.approve(pool.target, ethers.MaxUint256);
    await pool.depositToHousePool(ethers.parseEther("1000"));
    await token.mint(player.address, ethers.parseEther("25"));
    await token.connect(player).approve(pool.target, ethers.MaxUint256);
    const reserve = ethers.parseEther("0.1");
    await pool.fundOracle({ value: reserve });
    await pool.connect(player).startPoolGame(ethers.parseEther("25"));
    const request = await pool.getGameRandomness(0n);
    expect(request.oracleSpent).to.be.greaterThan(0n);
    expect(await pool.getOracleReserve()).to.equal(
      reserve - request.oracleSpent,
    );
    expect(await ethers.provider.getBalance(wrapper.target)).to.equal(
      request.oracleSpent,
    );
    await coordinator.fulfillRandomWordsWithOverride(
      request.requestId,
      wrapper.target,
      [123n],
      { gasLimit: 1_000_000 },
    );
    expect((await pool.getGameCore(0n)).state).to.equal(2n);
    await pool.connect(processor).processRandomness(0n);
    expect(await pool.getPlayerCards(0n)).to.have.length(2);
    await pool.connect(player).hit(0n);
    const second = await pool.getGameRandomness(0n);
    expect(second.requestId).not.to.equal(request.requestId);
    expect(second.oracleSpent).to.be.greaterThan(request.oracleSpent);
    await coordinator.fulfillRandomWordsWithOverride(
      second.requestId,
      wrapper.target,
      [456n],
      { gasLimit: 1_000_000 },
    );
    expect((await pool.getGameCore(0n)).state).to.equal(2n);
    await pool.connect(processor).processRandomness(0n);
    expect(await pool.getPlayerCards(0n)).to.have.length(3);
  });
});
