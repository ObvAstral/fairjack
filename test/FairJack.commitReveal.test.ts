import { expect } from "chai";
import { network } from "hardhat";
import { createCommit, createSecret } from "./helpers/cryptoHelpers.js";

const { ethers, networkHelpers } = await network.create();
const INITIAL_BALANCE = ethers.parseEther("10000");
const MIN_COLLATERAL = ethers.parseEther("100");
const BET = ethers.parseEther("25");

describe("FairJackPool commit-reveal", function () {
  async function deployGameFixture() {
    const [staker, player, validatorA, validatorB, validatorC, outsider] =
      await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20");
    const pool = await ethers.deployContract("FairJackPool", [token.target]);
    const accounts = [
      staker,
      player,
      validatorA,
      validatorB,
      validatorC,
      outsider,
    ];

    for (const account of accounts) {
      await token.mint(account.address, INITIAL_BALANCE);
      await token.connect(account).approve(pool.target, INITIAL_BALANCE);
    }
    await pool
      .connect(staker)
      .depositToHousePool(ethers.parseEther("1000"));
    for (const validator of [validatorA, validatorB, validatorC]) {
      await pool.connect(validator).registerAsValidator(MIN_COLLATERAL);
    }
    await pool.connect(player).startPoolGame(BET);

    const committee = await pool.getGameValidators(0n);
    const signersByAddress = new Map(
      accounts.map((account) => [account.address.toLowerCase(), account]),
    );
    const committeeSigners = committee.map((address) => {
      const signer = signersByAddress.get(address.toLowerCase());
      if (signer === undefined) {
        throw new Error(`Missing signer for committee member ${address}`);
      }
      return signer;
    });

    return {
      token,
      pool,
      player,
      outsider,
      committee,
      committeeSigners,
    };
  }

  async function prepareAllCommits() {
    const fixture = await deployGameFixture();
    const contractAddress = await fixture.pool.getAddress();
    const playerSecret = createSecret();
    const playerCommit = createCommit(
      playerSecret,
      0n,
      fixture.player.address,
      contractAddress,
    );
    const validatorSecrets = fixture.committeeSigners.map(() => createSecret());
    const validatorCommits = fixture.committeeSigners.map((validator, index) =>
      createCommit(
        validatorSecrets[index],
        0n,
        validator.address,
        contractAddress,
      ),
    );

    await fixture.pool.connect(fixture.player).submitPlayerCommit(0n, playerCommit);
    for (let index = 0; index < fixture.committeeSigners.length; ++index) {
      await fixture.pool
        .connect(fixture.committeeSigners[index])
        .submitValidatorCommit(0n, validatorCommits[index]);
    }

    return {
      ...fixture,
      playerSecret,
      playerCommit,
      validatorSecrets,
      validatorCommits,
    };
  }

  it("accepts the player commit after game creation", async function () {
    const { pool, player } =
      await networkHelpers.loadFixture(deployGameFixture);
    const secret = createSecret();
    const commitment = createCommit(
      secret,
      0n,
      player.address,
      await pool.getAddress(),
    );

    await expect(pool.connect(player).submitPlayerCommit(0n, commitment))
      .to.emit(pool, "CommitSubmitted")
      .withArgs(0n, player.address, true, commitment);

    const progress = await pool.getGameRandomnessProgress(0n);
    expect(progress.playerCommit).to.equal(commitment);
    expect(progress.playerCommitted).to.equal(true);
    expect(progress.commitCount).to.equal(1n);
  });

  it("uses exactly the same commitment encoding on-chain and off-chain", async function () {
    const { pool, player } =
      await networkHelpers.loadFixture(deployGameFixture);
    const secret = createSecret();
    const offChainCommit = createCommit(
      secret,
      0n,
      player.address,
      await pool.getAddress(),
    );

    expect(await pool.computeCommitment(secret, 0n, player.address)).to.equal(
      offChainCommit,
    );
  });

  it("accepts a commit from a selected validator", async function () {
    const { pool, committeeSigners } =
      await networkHelpers.loadFixture(deployGameFixture);
    const validator = committeeSigners[0];
    const commitment = createCommit(
      createSecret(),
      0n,
      validator.address,
      await pool.getAddress(),
    );

    await pool.connect(validator).submitValidatorCommit(0n, commitment);

    const status = await pool.getValidatorRandomnessStatus(
      0n,
      validator.address,
    );
    expect(status.commitment).to.equal(commitment);
    expect(status.committed).to.equal(true);
  });

  it("rejects a commit from a non-selected validator", async function () {
    const { pool, outsider } =
      await networkHelpers.loadFixture(deployGameFixture);

    await expect(
      pool
        .connect(outsider)
        .submitValidatorCommit(0n, ethers.keccak256(createSecret())),
    ).to.be.revertedWithCustomError(pool, "NotSelectedValidator");
  });

  it("rejects duplicate commits", async function () {
    const { pool, player, committeeSigners } =
      await networkHelpers.loadFixture(deployGameFixture);
    const playerCommit = createCommit(
      createSecret(),
      0n,
      player.address,
      await pool.getAddress(),
    );
    await pool.connect(player).submitPlayerCommit(0n, playerCommit);

    await expect(
      pool.connect(player).submitPlayerCommit(0n, playerCommit),
    ).to.be.revertedWithCustomError(pool, "CommitAlreadySubmitted");

    const validator = committeeSigners[0];
    const validatorCommit = createCommit(
      createSecret(),
      0n,
      validator.address,
      await pool.getAddress(),
    );
    await pool.connect(validator).submitValidatorCommit(0n, validatorCommit);
    await expect(
      pool.connect(validator).submitValidatorCommit(0n, validatorCommit),
    ).to.be.revertedWithCustomError(pool, "CommitAlreadySubmitted");
  });

  it("starts the reveal phase only after all four commits", async function () {
    const prepared = await networkHelpers.loadFixture(prepareAllCommits);

    expect((await prepared.pool.getGameCore(0n)).state).to.equal(2n);
    expect(
      (await prepared.pool.getGameDeadlines(0n)).revealDeadline,
    ).to.be.greaterThan(0n);
    expect(
      (await prepared.pool.getGameRandomnessProgress(0n)).commitCount,
    ).to.equal(4n);
  });

  it("rejects reveals before every participant has committed", async function () {
    const { pool, player } =
      await networkHelpers.loadFixture(deployGameFixture);
    const secret = createSecret();
    await pool
      .connect(player)
      .submitPlayerCommit(
        0n,
        createCommit(secret, 0n, player.address, await pool.getAddress()),
      );

    await expect(
      pool.connect(player).revealPlayerSecret(0n, secret),
    ).to.be.revertedWithCustomError(pool, "InvalidGameState");
  });

  it("accepts correct player and validator reveals", async function () {
    const prepared = await networkHelpers.loadFixture(prepareAllCommits);

    await expect(
      prepared.pool
        .connect(prepared.player)
        .revealPlayerSecret(0n, prepared.playerSecret),
    )
      .to.emit(prepared.pool, "SecretRevealed")
      .withArgs(0n, prepared.player.address, true);

    for (let index = 0; index < prepared.committeeSigners.length; ++index) {
      await prepared.pool
        .connect(prepared.committeeSigners[index])
        .revealValidatorSecret(0n, prepared.validatorSecrets[index]);
    }

    const progress = await prepared.pool.getGameRandomnessProgress(0n);
    expect(progress.playerRevealed).to.equal(true);
    expect(progress.revealCount).to.equal(4n);
    expect(await prepared.pool.lockedLiquidity()).to.equal(BET * 2n);
    expect(await prepared.pool.poolBalance()).to.equal(
      ethers.parseEther("1000"),
    );
    for (const validator of prepared.committee) {
      expect((await prepared.pool.validators(validator)).activeGames).to.equal(
        1n,
      );
    }
  });

  it("rejects an incorrect reveal", async function () {
    const prepared = await networkHelpers.loadFixture(prepareAllCommits);

    await expect(
      prepared.pool
        .connect(prepared.player)
        .revealPlayerSecret(0n, createSecret()),
    ).to.be.revertedWithCustomError(
      prepared.pool,
      "SecretDoesNotMatchCommit",
    );
  });

  it("rejects reveals from the wrong address", async function () {
    const prepared = await networkHelpers.loadFixture(prepareAllCommits);

    await expect(
      prepared.pool
        .connect(prepared.outsider)
        .revealPlayerSecret(0n, prepared.playerSecret),
    ).to.be.revertedWithCustomError(prepared.pool, "NotGamePlayer");
    await expect(
      prepared.pool
        .connect(prepared.outsider)
        .revealValidatorSecret(0n, prepared.validatorSecrets[0]),
    ).to.be.revertedWithCustomError(prepared.pool, "NotSelectedValidator");
  });

  it("rejects duplicate reveals", async function () {
    const prepared = await networkHelpers.loadFixture(prepareAllCommits);
    await prepared.pool
      .connect(prepared.player)
      .revealPlayerSecret(0n, prepared.playerSecret);

    await expect(
      prepared.pool
        .connect(prepared.player)
        .revealPlayerSecret(0n, prepared.playerSecret),
    ).to.be.revertedWithCustomError(prepared.pool, "SecretAlreadyRevealed");
  });
});
