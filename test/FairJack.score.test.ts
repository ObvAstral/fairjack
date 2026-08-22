import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("FairJackPool blackjack scoring", function () {
  async function deployScoringFixture() {
    const token = await ethers.deployContract("MockERC20");
    const scoring = await ethers.deployContract("BlackjackScoringHarness", [
      token.target,
    ]);

    return { token, scoring };
  }

  const scoringCases = [
    { hand: [0, 8], expected: 20n, label: "A + 9" },
    { hand: [0, 8, 4], expected: 15n, label: "A + 9 + 5" },
    { hand: [0, 13, 8], expected: 21n, label: "A + A + 9" },
    { hand: [0, 13, 8, 12], expected: 21n, label: "A + A + 9 + K" },
    { hand: [9, 12], expected: 20n, label: "10 + K" },
    { hand: [9, 12, 1], expected: 22n, label: "10 + K + 2" },
  ];

  for (const { hand, expected, label } of scoringCases) {
    it(`scores ${label} as ${expected}`, async function () {
      const { scoring } =
        await networkHelpers.loadFixture(deployScoringFixture);

      expect(await scoring.scoreHandForTest(hand)).to.equal(expected);
    });
  }

  it("treats every suit of the same rank equally", async function () {
    const { scoring } =
      await networkHelpers.loadFixture(deployScoringFixture);

    expect(await scoring.scoreHandForTest([0, 8])).to.equal(20n);
    expect(await scoring.scoreHandForTest([13, 21])).to.equal(20n);
    expect(await scoring.scoreHandForTest([26, 34])).to.equal(20n);
    expect(await scoring.scoreHandForTest([39, 47])).to.equal(20n);
  });

  it("rejects values outside the physical deck", async function () {
    const { scoring } =
      await networkHelpers.loadFixture(deployScoringFixture);

    await expect(
      scoring.scoreHandForTest([52]),
    ).to.be.revertedWithCustomError(scoring, "InvalidCard");
  });

  it("scores a hand produced by deterministic card drawing", async function () {
    const { token } = await networkHelpers.loadFixture(deployScoringFixture);
    const cards = await ethers.deployContract("CardDrawingHarness", [
      token.target,
    ]);
    const seed = ethers.keccak256(ethers.toUtf8Bytes("integrated score seed"));
    await cards.createCardTestGame(seed);
    await cards.drawCardsForTest(0n, 8n, true);
    const hand = await cards.getPlayerCards(0n);

    let expected = 0;
    let aces = 0;
    for (const rawCard of hand) {
      const rank = Number(rawCard) % 13;
      if (rank === 0) {
        expected += 11;
        ++aces;
      } else if (rank >= 9) {
        expected += 10;
      } else {
        expected += rank + 1;
      }
    }
    while (expected > 21 && aces > 0) {
      expected -= 10;
      --aces;
    }

    expect(await cards.getPlayerScore(0n)).to.equal(BigInt(expected));
  });
});
