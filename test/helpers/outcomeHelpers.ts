import { createCommit, createFinalSeed } from "./cryptoHelpers.js";
import { ethers } from "./deployFixture.js";
import { createGame } from "./gameHelpers.js";

type TargetOutcome = "playerWin" | "dealerWin" | "push" | "dealerBust";

function secretFromNumber(value: number): string {
  return ethers.zeroPadValue(ethers.toBeHex(value), 32);
}

export function scoreHand(cards: readonly bigint[]): number {
  let score = 0;
  let aces = 0;

  for (const card of cards) {
    const rank = Number(card) % 13;
    if (rank === 0) {
      score += 11;
      ++aces;
    } else if (rank >= 9) {
      score += 10;
    } else {
      score += rank + 1;
    }
  }
  while (score > 21 && aces > 0) {
    score -= 10;
    --aces;
  }

  return score;
}

function simulateStand(seed: string) {
  const drawn = new Set<number>();
  let nonce = 0n;

  const draw = (): bigint => {
    while (true) {
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256"],
        [seed, nonce],
      );
      const card = Number(BigInt(ethers.keccak256(encoded)) % 52n);
      ++nonce;
      if (!drawn.has(card)) {
        drawn.add(card);
        return BigInt(card);
      }
    }
  };

  const playerCards = [draw(), draw()];
  const dealerCards = [draw(), draw()];
  const playerScore = scoreHand(playerCards);
  let dealerScore = scoreHand(dealerCards);
  while (dealerScore < 17) {
    dealerCards.push(draw());
    dealerScore = scoreHand(dealerCards);
  }

  return { playerCards, dealerCards, playerScore, dealerScore };
}

async function reachTargetOutcome(target: TargetOutcome) {
  const fixture = await createGame();
  const contractAddress = await fixture.pool.getAddress();
  const validatorSecrets: [string, string, string] = [
    secretFromNumber(1001),
    secretFromNumber(1002),
    secretFromNumber(1003),
  ];

  let playerSecret = ethers.ZeroHash;
  let expected: ReturnType<typeof simulateStand> | undefined;
  for (let candidate = 1; candidate <= 10_000; ++candidate) {
    const candidateSecret = secretFromNumber(candidate);
    const seed = createFinalSeed(
      0n,
      candidateSecret,
      validatorSecrets,
      contractAddress,
    );
    const simulation = simulateStand(seed);
    const matches =
      (target === "playerWin" &&
        simulation.dealerScore <= 21 &&
        simulation.playerScore > simulation.dealerScore) ||
      (target === "dealerWin" &&
        simulation.dealerScore <= 21 &&
        simulation.dealerScore > simulation.playerScore) ||
      (target === "push" &&
        simulation.dealerScore === simulation.playerScore) ||
      (target === "dealerBust" && simulation.dealerScore > 21);

    if (matches) {
      playerSecret = candidateSecret;
      expected = simulation;
      break;
    }
  }

  if (expected === undefined) {
    throw new Error(`Unable to find deterministic seed for ${target}`);
  }

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

  await fixture.pool
    .connect(fixture.player)
    .revealPlayerSecret(0n, playerSecret);
  for (let index = 0; index < fixture.committeeSigners.length; ++index) {
    await fixture.pool
      .connect(fixture.committeeSigners[index])
      .revealValidatorSecret(0n, validatorSecrets[index]);
  }

  return { ...fixture, playerSecret, validatorSecrets, expected };
}

export async function reachPlayerWinTurn() {
  return reachTargetOutcome("playerWin");
}

export async function reachDealerWinTurn() {
  return reachTargetOutcome("dealerWin");
}

export async function reachPushTurn() {
  return reachTargetOutcome("push");
}

export async function reachDealerBustTurn() {
  return reachTargetOutcome("dealerBust");
}
