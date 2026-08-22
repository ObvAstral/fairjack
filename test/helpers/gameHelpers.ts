import { createCommit, createSecret } from "./cryptoHelpers.js";
import { deployFixture, ethers } from "./deployFixture.js";

export const TEST_POOL_DEPOSIT = ethers.parseEther("1000");
export const TEST_VALIDATOR_COLLATERAL = ethers.parseEther("200");
export const TEST_BET = ethers.parseEther("25");

export async function createPool() {
  const fixture = await deployFixture();
  await fixture.pool
    .connect(fixture.staker)
    .depositToHousePool(TEST_POOL_DEPOSIT);
  return fixture;
}

export async function registerThreeValidators() {
  const fixture = await createPool();
  for (const validator of [
    fixture.validatorA,
    fixture.validatorB,
    fixture.validatorC,
  ]) {
    await fixture.pool
      .connect(validator)
      .registerAsValidator(TEST_VALIDATOR_COLLATERAL);
  }
  return fixture;
}

export async function createGame() {
  const fixture = await registerThreeValidators();
  await fixture.pool.connect(fixture.player).startPoolGame(TEST_BET);

  const committee = await fixture.pool.getGameValidators(0n);
  const signersByAddress = new Map(
    fixture.accounts.map((account) => [
      account.address.toLowerCase(),
      account,
    ]),
  );
  const committeeSigners = committee.map((address) => {
    const signer = signersByAddress.get(address.toLowerCase());
    if (signer === undefined) {
      throw new Error(`Missing signer for committee member ${address}`);
    }
    return signer;
  });

  return { ...fixture, committee, committeeSigners };
}

export async function submitAllCommits() {
  const fixture = await createGame();
  const contractAddress = await fixture.pool.getAddress();
  const playerSecret = createSecret();
  const validatorSecrets: [string, string, string] = [
    createSecret(),
    createSecret(),
    createSecret(),
  ];

  await fixture.pool
    .connect(fixture.player)
    .submitPlayerCommit(
      0n,
      createCommit(
        playerSecret,
        0n,
        fixture.player.address,
        contractAddress,
      ),
    );

  for (let index = 0; index < fixture.committeeSigners.length; ++index) {
    const validator = fixture.committeeSigners[index];
    await fixture.pool
      .connect(validator)
      .submitValidatorCommit(
        0n,
        createCommit(
          validatorSecrets[index],
          0n,
          validator.address,
          contractAddress,
        ),
      );
  }

  return { ...fixture, playerSecret, validatorSecrets };
}

export async function submitAllReveals() {
  const fixture = await submitAllCommits();
  await fixture.pool
    .connect(fixture.player)
    .revealPlayerSecret(0n, fixture.playerSecret);

  let lastRevealTransaction;
  for (let index = 0; index < fixture.committeeSigners.length; ++index) {
    lastRevealTransaction = await fixture.pool
      .connect(fixture.committeeSigners[index])
      .revealValidatorSecret(0n, fixture.validatorSecrets[index]);
  }

  if (lastRevealTransaction === undefined) {
    throw new Error("The validator committee is empty");
  }

  return { ...fixture, lastRevealTransaction };
}

export async function reachPlayerTurn() {
  return submitAllReveals();
}
