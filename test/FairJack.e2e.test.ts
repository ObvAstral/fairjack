import { expect } from "chai";
import { createCommit, createSecret } from "./helpers/cryptoHelpers.js";
import { ethers } from "./helpers/deployFixture.js";

describe("FairJack end-to-end game", function () {
  it("runs a complete pool-backed blackjack game", async function () {
    const [alice, bob, validatorA, validatorB, validatorC] =
      await ethers.getSigners();
    const initialBalance = ethers.parseEther("2000");
    const poolDeposit = ethers.parseEther("1000");
    const collateral = ethers.parseEther("200");
    const bet = ethers.parseEther("25");

    // 1-8. Deploy contracts, fund every participant, and approve transfers.
    const token = await ethers.deployContract("MockERC20");
    const pool = await ethers.deployContract("FairJackPool", [token.target]);
    for (const account of [
      alice,
      bob,
      validatorA,
      validatorB,
      validatorC,
    ]) {
      await token.mint(account.address, initialBalance);
      await token.connect(account).approve(pool.target, initialBalance);
    }

    // 2. Alice creates the staked house bankroll.
    await pool.connect(alice).depositToHousePool(poolDeposit);
    expect(await pool.sharesOf(alice.address)).to.equal(poolDeposit);

    // 3-6. Three independently funded accounts opt into validation.
    for (const validator of [validatorA, validatorB, validatorC]) {
      await pool.connect(validator).registerAsValidator(collateral);
    }

    // 7-10. Bob creates the game; the contract locks payout and committee.
    await pool.connect(bob).startPoolGame(bet);
    const gameId = 0n;
    const committee = await pool.getGameValidators(gameId);
    expect(new Set(committee).size).to.equal(3);
    expect(await pool.lockedLiquidity()).to.equal(bet * 2n);

    const validatorSigners = [validatorA, validatorB, validatorC];
    const signersByAddress = new Map(
      validatorSigners.map((validator) => [
        validator.address.toLowerCase(),
        validator,
      ]),
    );
    const committeeSigners = committee.map((address) => {
      const signer = signersByAddress.get(address.toLowerCase());
      if (signer === undefined) {
        throw new Error(`Missing signer for validator ${address}`);
      }
      return signer;
    });

    // 11-14. Secrets are generated off-chain and remain local until reveal.
    const playerSecret = createSecret();
    const validatorSecrets: [string, string, string] = [
      createSecret(),
      createSecret(),
      createSecret(),
    ];
    const contractAddress = await pool.getAddress();

    // 15-18. Bob and the selected validators submit domain-bound commits.
    await pool
      .connect(bob)
      .submitPlayerCommit(
        gameId,
        createCommit(
          playerSecret,
          gameId,
          bob.address,
          contractAddress,
        ),
      );
    for (let index = 0; index < committeeSigners.length; ++index) {
      const validator = committeeSigners[index];
      await pool
        .connect(validator)
        .submitValidatorCommit(
          gameId,
          createCommit(
            validatorSecrets[index],
            gameId,
            validator.address,
            contractAddress,
          ),
        );
    }
    expect((await pool.getGameCore(gameId)).state).to.equal(2n);

    // 19-24. Every participant reveals; seed and initial cards are generated.
    await pool.connect(bob).revealPlayerSecret(gameId, playerSecret);
    for (let index = 0; index < committeeSigners.length; ++index) {
      await pool
        .connect(committeeSigners[index])
        .revealValidatorSecret(gameId, validatorSecrets[index]);
    }
    const randomness = await pool.getGameRandomnessProgress(gameId);
    expect(randomness.finalSeed).not.to.equal(ethers.ZeroHash);
    expect(randomness.revealCount).to.equal(4n);
    expect((await pool.getGameCore(gameId)).state).to.equal(3n);

    const initialCards = [
      ...(await pool.getPlayerCards(gameId)),
      ...(await pool.getDealerCards(gameId)),
    ];
    expect(initialCards).to.have.length(4);
    expect(new Set(initialCards.map(Number)).size).to.equal(4);

    // 25-28. Bob stands; dealer resolution and payout are automatic.
    await pool.connect(bob).stand(gameId);
    const game = await pool.getGameCore(gameId);
    const outcome = await pool.getGameResult(gameId);
    expect(game.state).to.equal(5n);
    expect(await pool.getDealerScore(gameId)).to.be.greaterThanOrEqual(17n);

    // 29-31. Locks, validator reservations, token balances, and pool agree.
    expect(await pool.lockedLiquidity()).to.equal(0n);
    expect(await pool.getAvailableLiquidity()).to.equal(
      await pool.poolBalance(),
    );
    for (const validator of committee) {
      expect((await pool.validators(validator)).activeGames).to.equal(0n);
    }

    let expectedPoolBalance = poolDeposit;
    let expectedBobBalance = initialBalance;
    if (outcome.result === 1n) {
      expectedPoolBalance -= bet;
      expectedBobBalance += bet;
      expect(outcome.payout).to.equal(bet * 2n);
    } else if (outcome.result === 2n) {
      expectedPoolBalance += bet;
      expectedBobBalance -= bet;
      expect(outcome.payout).to.equal(0n);
    } else {
      expect(outcome.result).to.equal(3n);
      expect(outcome.payout).to.equal(bet);
    }

    expect(await pool.poolBalance()).to.equal(expectedPoolBalance);
    expect(await token.balanceOf(bob.address)).to.equal(expectedBobBalance);
    expect(await token.balanceOf(pool.target)).to.equal(
      expectedPoolBalance + collateral * 3n,
    );
    expect(await pool.totalShares()).to.equal(poolDeposit);
  });
});
