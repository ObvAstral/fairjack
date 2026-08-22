import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const MIN_COLLATERAL = ethers.parseEther("100");
const INITIAL_BALANCE = ethers.parseEther("1000");

describe("FairJackPool validators", function () {
  async function deployValidatorFixture() {
    const [staker, player, validatorA, validatorB, validatorC, validatorD] =
      await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20");
    const pool = await ethers.deployContract("ValidatorSelectionHarness", [
      token.target,
    ]);

    for (const account of [
      staker,
      player,
      validatorA,
      validatorB,
      validatorC,
      validatorD,
    ]) {
      await token.mint(account.address, INITIAL_BALANCE);
      await token.connect(account).approve(pool.target, INITIAL_BALANCE);
    }

    return {
      token,
      pool,
      staker,
      player,
      validatorA,
      validatorB,
      validatorC,
      validatorD,
    };
  }

  it("registers a validator with collateral", async function () {
    const { pool, validatorA } =
      await networkHelpers.loadFixture(deployValidatorFixture);

    await expect(pool.connect(validatorA).registerAsValidator(MIN_COLLATERAL))
      .to.emit(pool, "ValidatorRegistered")
      .withArgs(validatorA.address, MIN_COLLATERAL);

    expect(await pool.validators(validatorA.address)).to.deep.equal([
      true,
      MIN_COLLATERAL,
      0n,
      0n,
    ]);
    expect(await pool.validatorList(0)).to.equal(validatorA.address);
  });

  it("keeps validator collateral separate from house pool accounting", async function () {
    const { token, pool, staker, validatorA } =
      await networkHelpers.loadFixture(deployValidatorFixture);
    const poolDeposit = ethers.parseEther("500");

    await pool.connect(staker).depositToHousePool(poolDeposit);
    await pool.connect(validatorA).registerAsValidator(MIN_COLLATERAL);

    expect(await token.balanceOf(pool.target)).to.equal(
      poolDeposit + MIN_COLLATERAL,
    );
    expect(await pool.poolBalance()).to.equal(poolDeposit);
    expect(await pool.getAvailableLiquidity()).to.equal(poolDeposit);
    expect(await pool.totalShares()).to.equal(poolDeposit);
  });

  it("rejects duplicate registration", async function () {
    const { pool, validatorA } =
      await networkHelpers.loadFixture(deployValidatorFixture);
    await pool.connect(validatorA).registerAsValidator(MIN_COLLATERAL);

    await expect(
      pool.connect(validatorA).registerAsValidator(MIN_COLLATERAL),
    ).to.be.revertedWithCustomError(pool, "AlreadyRegisteredValidator");
  });

  it("rejects registration below the minimum collateral", async function () {
    const { pool, validatorA } =
      await networkHelpers.loadFixture(deployValidatorFixture);

    await expect(
      pool.connect(validatorA).registerAsValidator(MIN_COLLATERAL - 1n),
    ).to.be.revertedWithCustomError(pool, "InsufficientValidatorCollateral");
  });

  it("adds collateral", async function () {
    const { pool, validatorA } =
      await networkHelpers.loadFixture(deployValidatorFixture);
    const extra = ethers.parseEther("50");
    await pool.connect(validatorA).registerAsValidator(MIN_COLLATERAL);

    await pool.connect(validatorA).addValidatorCollateral(extra);

    const info = await pool.validators(validatorA.address);
    expect(info.collateral).to.equal(MIN_COLLATERAL + extra);
  });

  it("withdraws collateral above the registered minimum", async function () {
    const { token, pool, validatorA } =
      await networkHelpers.loadFixture(deployValidatorFixture);
    const extra = ethers.parseEther("50");
    await pool
      .connect(validatorA)
      .registerAsValidator(MIN_COLLATERAL + extra);

    await pool.connect(validatorA).withdrawValidatorCollateral(extra);

    expect((await pool.validators(validatorA.address)).collateral).to.equal(
      MIN_COLLATERAL,
    );
    expect(await token.balanceOf(validatorA.address)).to.equal(
      INITIAL_BALANCE - MIN_COLLATERAL,
    );
  });

  it("does not allow collateral reserved for an active game to be withdrawn", async function () {
    const { pool, validatorA } =
      await networkHelpers.loadFixture(deployValidatorFixture);
    await pool
      .connect(validatorA)
      .registerAsValidator(MIN_COLLATERAL * 2n);
    await pool.reserveValidatorForTest(validatorA.address);

    await expect(
      pool
        .connect(validatorA)
        .withdrawValidatorCollateral(MIN_COLLATERAL + 1n),
    ).to.be.revertedWithCustomError(
      pool,
      "InsufficientWithdrawableCollateral",
    );
  });

  it("selects three distinct registered validators", async function () {
    const { pool, player, validatorA, validatorB, validatorC } =
      await networkHelpers.loadFixture(deployValidatorFixture);
    for (const validator of [validatorA, validatorB, validatorC]) {
      await pool.connect(validator).registerAsValidator(MIN_COLLATERAL);
    }

    const committee = await pool.selectValidatorsForTest(player.address, 1n);

    expect(new Set(committee).size).to.equal(3);
    for (const member of committee) {
      expect(
        (await pool.validators(member)).registered,
        `${member} is not registered`,
      ).to.equal(true);
    }
  });

  it("excludes the player from the committee", async function () {
    const {
      pool,
      player,
      validatorA,
      validatorB,
      validatorC,
      validatorD,
    } = await networkHelpers.loadFixture(deployValidatorFixture);
    for (const validator of [
      player,
      validatorA,
      validatorB,
      validatorC,
      validatorD,
    ]) {
      await pool.connect(validator).registerAsValidator(MIN_COLLATERAL);
    }

    const committee = await pool.selectValidatorsForTest(player.address, 7n);

    expect(committee).not.to.include(player.address);
    expect(new Set(committee).size).to.equal(3);
  });

  it("excludes validators without collateral for another active game", async function () {
    const {
      pool,
      player,
      validatorA,
      validatorB,
      validatorC,
      validatorD,
    } = await networkHelpers.loadFixture(deployValidatorFixture);
    for (const validator of [validatorA, validatorB, validatorC, validatorD]) {
      await pool.connect(validator).registerAsValidator(MIN_COLLATERAL);
    }
    await pool.reserveValidatorForTest(validatorA.address);

    const committee = await pool.selectValidatorsForTest(player.address, 11n);

    expect(committee).not.to.include(validatorA.address);
    expect(new Set(committee).size).to.equal(3);
  });

  it("rejects unregistering while a validator has an active game", async function () {
    const { pool, validatorA } =
      await networkHelpers.loadFixture(deployValidatorFixture);
    await pool.connect(validatorA).registerAsValidator(MIN_COLLATERAL);
    await pool.reserveValidatorForTest(validatorA.address);

    await expect(
      pool.connect(validatorA).unregisterAsValidator(),
    ).to.be.revertedWithCustomError(pool, "ValidatorHasActiveGames");
  });

  it("unregisters only when no game is active and returns collateral", async function () {
    const { token, pool, validatorA } =
      await networkHelpers.loadFixture(deployValidatorFixture);
    await pool.connect(validatorA).registerAsValidator(MIN_COLLATERAL);

    await pool.connect(validatorA).unregisterAsValidator();

    expect(await pool.getValidatorCount()).to.equal(0n);
    expect((await pool.validators(validatorA.address)).registered).to.equal(
      false,
    );
    expect(await token.balanceOf(validatorA.address)).to.equal(INITIAL_BALANCE);
  });
});
