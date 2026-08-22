import { expect } from "chai";
import { network } from "hardhat";
import {
  createCommit,
  createFinalSeed,
  createSecret,
} from "./helpers/cryptoHelpers.js";

const { ethers, networkHelpers } = await network.create();
const INITIAL_BALANCE = ethers.parseEther("10000");
const MIN_COLLATERAL = ethers.parseEther("100");
const BET = ethers.parseEther("25");

describe("FairJackPool randomness", function () {
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
      await pool
        .connect(validator)
        .registerAsValidator(MIN_COLLATERAL * 2n);
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
      signersByAddress,
    };
  }

  type GameFixture = Awaited<ReturnType<typeof deployGameFixture>>;
  type CommitteeSigners = GameFixture["committeeSigners"];

  function createValidatorSecrets(): [string, string, string] {
    return [createSecret(), createSecret(), createSecret()];
  }

  async function submitCommits(
    fixture: GameFixture,
    gameId: bigint,
    playerSecret: string,
    validatorSecrets: readonly [string, string, string],
    committeeSigners: CommitteeSigners = fixture.committeeSigners,
  ) {
    const contractAddress = await fixture.pool.getAddress();
    const playerCommit = createCommit(
      playerSecret,
      gameId,
      fixture.player.address,
      contractAddress,
    );
    const validatorCommits = committeeSigners.map((validator, index) =>
      createCommit(
        validatorSecrets[index],
        gameId,
        validator.address,
        contractAddress,
      ),
    );

    await fixture.pool
      .connect(fixture.player)
      .submitPlayerCommit(gameId, playerCommit);
    for (let index = 0; index < committeeSigners.length; ++index) {
      await fixture.pool
        .connect(committeeSigners[index])
        .submitValidatorCommit(gameId, validatorCommits[index]);
    }

    return { playerCommit, validatorCommits };
  }

  async function revealSecrets(
    fixture: GameFixture,
    gameId: bigint,
    playerSecret: string,
    validatorSecrets: readonly [string, string, string],
    committeeSigners: CommitteeSigners = fixture.committeeSigners,
    validatorOrder: readonly number[] = [0, 1, 2],
    playerFirst = true,
  ) {
    if (playerFirst) {
      await fixture.pool
        .connect(fixture.player)
        .revealPlayerSecret(gameId, playerSecret);
    }
    for (const index of validatorOrder) {
      await fixture.pool
        .connect(committeeSigners[index])
        .revealValidatorSecret(gameId, validatorSecrets[index]);
    }
    if (!playerFirst) {
      await fixture.pool
        .connect(fixture.player)
        .revealPlayerSecret(gameId, playerSecret);
    }
  }

  async function prepareAllCommits() {
    const fixture = await deployGameFixture();
    const playerSecret = createSecret();
    const validatorSecrets = createValidatorSecrets();
    const { playerCommit, validatorCommits } = await submitCommits(
      fixture,
      0n,
      playerSecret,
      validatorSecrets,
    );

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

  it("does not generate the seed before all four reveals", async function () {
    const prepared = await networkHelpers.loadFixture(prepareAllCommits);
    await prepared.pool
      .connect(prepared.player)
      .revealPlayerSecret(0n, prepared.playerSecret);
    await prepared.pool
      .connect(prepared.committeeSigners[0])
      .revealValidatorSecret(0n, prepared.validatorSecrets[0]);
    await prepared.pool
      .connect(prepared.committeeSigners[1])
      .revealValidatorSecret(0n, prepared.validatorSecrets[1]);

    expect(
      (await prepared.pool.getGameRandomnessProgress(0n)).finalSeed,
    ).to.equal(ethers.ZeroHash);

    await expect(
      prepared.pool
        .connect(prepared.committeeSigners[2])
        .revealValidatorSecret(0n, prepared.validatorSecrets[2]),
    ).to.emit(prepared.pool, "FinalSeedGenerated");
  });

  it("matches the deterministic final-seed formula", async function () {
    const prepared = await networkHelpers.loadFixture(prepareAllCommits);
    await revealSecrets(
      prepared,
      0n,
      prepared.playerSecret,
      prepared.validatorSecrets,
    );

    const expectedSeed = createFinalSeed(
      0n,
      prepared.playerSecret,
      prepared.validatorSecrets,
      await prepared.pool.getAddress(),
    );
    expect(
      (await prepared.pool.getGameRandomnessProgress(0n)).finalSeed,
    ).to.equal(expectedSeed);
  });

  it("cannot reuse a reveal commitment in another game", async function () {
    const fixture = await networkHelpers.loadFixture(deployGameFixture);
    await fixture.pool.connect(fixture.player).startPoolGame(BET);
    const secondCommittee = await fixture.pool.getGameValidators(1n);
    const secondCommitteeSigners = secondCommittee.map((address) => {
      const signer = fixture.signersByAddress.get(address.toLowerCase());
      if (signer === undefined) {
        throw new Error(`Missing signer for committee member ${address}`);
      }
      return signer;
    });
    const playerSecret = createSecret();
    const commitForGameZero = createCommit(
      playerSecret,
      0n,
      fixture.player.address,
      await fixture.pool.getAddress(),
    );
    await fixture.pool
      .connect(fixture.player)
      .submitPlayerCommit(1n, commitForGameZero);

    const validatorSecrets = createValidatorSecrets();
    for (let index = 0; index < secondCommitteeSigners.length; ++index) {
      const validator = secondCommitteeSigners[index];
      await fixture.pool
        .connect(validator)
        .submitValidatorCommit(
          1n,
          createCommit(
            validatorSecrets[index],
            1n,
            validator.address,
            await fixture.pool.getAddress(),
          ),
        );
    }

    await expect(
      fixture.pool
        .connect(fixture.player)
        .revealPlayerSecret(1n, playerSecret),
    ).to.be.revertedWithCustomError(
      fixture.pool,
      "SecretDoesNotMatchCommit",
    );
  });

  it("produces the same seed from the same inputs", async function () {
    const fixture = await networkHelpers.loadFixture(deployGameFixture);
    const playerSecret = createSecret();
    const validatorSecrets = createValidatorSecrets();
    const snapshot = await networkHelpers.takeSnapshot();

    await submitCommits(fixture, 0n, playerSecret, validatorSecrets);
    await revealSecrets(fixture, 0n, playerSecret, validatorSecrets);
    const firstSeed = (await fixture.pool.getGameRandomnessProgress(0n))
      .finalSeed;

    await snapshot.restore();
    await submitCommits(fixture, 0n, playerSecret, validatorSecrets);
    await revealSecrets(fixture, 0n, playerSecret, validatorSecrets);
    const secondSeed = (await fixture.pool.getGameRandomnessProgress(0n))
      .finalSeed;

    expect(secondSeed).to.equal(firstSeed);
  });

  it("changes the seed when one secret changes", async function () {
    const fixture = await networkHelpers.loadFixture(deployGameFixture);
    const playerSecret = createSecret();
    const originalSecrets = createValidatorSecrets();
    const snapshot = await networkHelpers.takeSnapshot();

    await submitCommits(fixture, 0n, playerSecret, originalSecrets);
    await revealSecrets(fixture, 0n, playerSecret, originalSecrets);
    const originalSeed = (await fixture.pool.getGameRandomnessProgress(0n))
      .finalSeed;

    await snapshot.restore();
    const modifiedSecrets: [string, string, string] = [
      createSecret(),
      originalSecrets[1],
      originalSecrets[2],
    ];
    await submitCommits(fixture, 0n, playerSecret, modifiedSecrets);
    await revealSecrets(fixture, 0n, playerSecret, modifiedSecrets);
    const modifiedSeed = (await fixture.pool.getGameRandomnessProgress(0n))
      .finalSeed;

    expect(modifiedSeed).not.to.equal(originalSeed);
  });

  it("keeps the seed identical when reveal transaction order changes", async function () {
    const prepared = await networkHelpers.loadFixture(prepareAllCommits);
    const snapshot = await networkHelpers.takeSnapshot();

    await revealSecrets(
      prepared,
      0n,
      prepared.playerSecret,
      prepared.validatorSecrets,
    );
    const firstSeed = (await prepared.pool.getGameRandomnessProgress(0n))
      .finalSeed;

    await snapshot.restore();
    await revealSecrets(
      prepared,
      0n,
      prepared.playerSecret,
      prepared.validatorSecrets,
      prepared.committeeSigners,
      [2, 0, 1],
      false,
    );
    const reorderedSeed = (await prepared.pool.getGameRandomnessProgress(0n))
      .finalSeed;

    expect(reorderedSeed).to.equal(firstSeed);
  });
});
