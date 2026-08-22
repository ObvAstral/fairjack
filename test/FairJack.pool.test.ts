import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const TOKEN_SUPPLY = ethers.parseEther("10000");

describe("FairJackPool house pool", function () {
  async function deployPoolFixture() {
    const [alice, bob] = await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20");
    const pool = await ethers.deployContract("PoolAccountingHarness", [
      token.target,
    ]);

    for (const account of [alice, bob]) {
      await token.mint(account.address, TOKEN_SUPPLY);
      await token.connect(account).approve(pool.target, TOKEN_SUPPLY);
    }

    return { token, pool, alice, bob };
  }

  it("accepts the initial deposit", async function () {
    const { token, pool, alice } =
      await networkHelpers.loadFixture(deployPoolFixture);
    const amount = ethers.parseEther("1000");

    await pool.connect(alice).depositToHousePool(amount);

    expect(await token.balanceOf(pool.target)).to.equal(amount);
    expect(await pool.poolBalance()).to.equal(amount);
  });

  it("mints initial shares one-to-one", async function () {
    const { pool, alice } = await networkHelpers.loadFixture(deployPoolFixture);
    const amount = ethers.parseEther("1000");

    await pool.connect(alice).depositToHousePool(amount);

    expect(await pool.sharesOf(alice.address)).to.equal(amount);
    expect(await pool.totalShares()).to.equal(amount);
  });

  it("accounts for deposits from multiple users", async function () {
    const { pool, alice, bob } =
      await networkHelpers.loadFixture(deployPoolFixture);
    const aliceAmount = ethers.parseEther("1000");
    const bobAmount = ethers.parseEther("500");

    await pool.connect(alice).depositToHousePool(aliceAmount);
    await pool.connect(bob).depositToHousePool(bobAmount);

    expect(await pool.poolBalance()).to.equal(aliceAmount + bobAmount);
    expect(await pool.totalShares()).to.equal(aliceAmount + bobAmount);
    expect(await pool.sharesOf(alice.address)).to.equal(aliceAmount);
    expect(await pool.sharesOf(bob.address)).to.equal(bobAmount);
  });

  it("mints proportional shares after pool profit", async function () {
    const { token, pool, alice, bob } =
      await networkHelpers.loadFixture(deployPoolFixture);
    const initialDeposit = ethers.parseEther("1000");
    const profit = ethers.parseEther("200");
    const bobDeposit = ethers.parseEther("120");

    await pool.connect(alice).depositToHousePool(initialDeposit);
    await token.mint(pool.target, profit);
    await pool.recordPoolProfit(profit);
    await pool.connect(bob).depositToHousePool(bobDeposit);

    expect(await pool.sharesOf(bob.address)).to.equal(
      ethers.parseEther("100"),
    );
  });

  it("does not unfairly dilute existing stakers", async function () {
    const { token, pool, alice, bob } =
      await networkHelpers.loadFixture(deployPoolFixture);
    const initialDeposit = ethers.parseEther("1000");
    const profit = ethers.parseEther("200");
    const bobDeposit = ethers.parseEther("120");

    await pool.connect(alice).depositToHousePool(initialDeposit);
    await token.mint(pool.target, profit);
    await pool.recordPoolProfit(profit);
    await pool.connect(bob).depositToHousePool(bobDeposit);

    await pool.connect(bob).withdrawFromHousePool(ethers.parseEther("100"));
    await pool.connect(alice).withdrawFromHousePool(initialDeposit);

    expect(await token.balanceOf(bob.address)).to.equal(TOKEN_SUPPLY);
    expect(await token.balanceOf(alice.address)).to.equal(
      TOKEN_SUPPLY + profit,
    );
  });

  it("withdraws the value represented by burned shares", async function () {
    const { token, pool, alice } =
      await networkHelpers.loadFixture(deployPoolFixture);
    const deposit = ethers.parseEther("1000");
    const shares = ethers.parseEther("250");

    await pool.connect(alice).depositToHousePool(deposit);
    await pool.connect(alice).withdrawFromHousePool(shares);

    expect(await token.balanceOf(alice.address)).to.equal(
      TOKEN_SUPPLY - deposit + shares,
    );
    expect(await pool.sharesOf(alice.address)).to.equal(deposit - shares);
    expect(await pool.poolBalance()).to.equal(deposit - shares);
  });

  it("rejects withdrawals above the caller share balance", async function () {
    const { pool, alice } = await networkHelpers.loadFixture(deployPoolFixture);
    const deposit = ethers.parseEther("1000");

    await pool.connect(alice).depositToHousePool(deposit);

    await expect(
      pool.connect(alice).withdrawFromHousePool(deposit + 1n),
    ).to.be.revertedWithCustomError(pool, "InsufficientShares");
  });

  it("rejects withdrawals that would consume locked liquidity", async function () {
    const { pool, alice } = await networkHelpers.loadFixture(deployPoolFixture);
    const deposit = ethers.parseEther("1000");
    await pool.connect(alice).depositToHousePool(deposit);
    await pool.setLockedLiquidityForTest(ethers.parseEther("800"));

    await expect(
      pool.connect(alice).withdrawFromHousePool(ethers.parseEther("300")),
    ).to.be.revertedWithCustomError(pool, "InsufficientAvailableLiquidity");
  });

  it("reports available liquidity as pool balance minus locks", async function () {
    const { pool, alice } = await networkHelpers.loadFixture(deployPoolFixture);
    await pool
      .connect(alice)
      .depositToHousePool(ethers.parseEther("1000"));
    await pool.setLockedLiquidityForTest(ethers.parseEther("350"));

    expect(await pool.getAvailableLiquidity()).to.equal(
      ethers.parseEther("650"),
    );
  });
});
