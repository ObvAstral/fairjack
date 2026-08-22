import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();

describe("FairJackPool deterministic card drawing", function () {
  async function deployCardFixture() {
    const [player] = await ethers.getSigners();
    const token = await ethers.deployContract("MockERC20");
    const pool = await ethers.deployContract("CardDrawingHarness", [
      token.target,
    ]);
    const seed = ethers.keccak256(ethers.toUtf8Bytes("fairjack test seed"));

    await pool.connect(player).createCardTestGame(seed);

    return { pool, player, seed };
  }

  it("derives a card from keccak256(abi.encode(seed, nonce))", async function () {
    const { pool, seed } =
      await networkHelpers.loadFixture(deployCardFixture);
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256"],
      [seed, 0n],
    );
    const expectedCard = BigInt(ethers.keccak256(encoded)) % 52n;

    await pool.drawCardsForTest(0n, 1n, true);

    expect((await pool.getPlayerCards(0n))[0]).to.equal(expectedCard);
  });

  it("produces the same sequence from the same seed", async function () {
    const { pool, seed } =
      await networkHelpers.loadFixture(deployCardFixture);
    await pool.createCardTestGame(seed);

    await pool.drawCardsForTest(0n, 20n, true);
    await pool.drawCardsForTest(1n, 20n, true);

    expect(await pool.getPlayerCards(1n)).to.deep.equal(
      await pool.getPlayerCards(0n),
    );
  });

  it("keeps every generated card in the 0..51 range", async function () {
    const { pool } = await networkHelpers.loadFixture(deployCardFixture);

    await pool.drawCardsForTest(0n, 30n, true);

    for (const card of await pool.getPlayerCards(0n)) {
      expect(card).to.be.at.least(0n).and.lessThan(52n);
    }
  });

  it("never duplicates a physical card across both hands", async function () {
    const { pool } = await networkHelpers.loadFixture(deployCardFixture);

    await pool.drawCardsForTest(0n, 26n, true);
    await pool.drawCardsForTest(0n, 26n, false);

    const allCards = [
      ...(await pool.getPlayerCards(0n)),
      ...(await pool.getDealerCards(0n)),
    ];
    expect(allCards).to.have.length(52);
    expect(new Set(allCards.map(Number)).size).to.equal(52);
    for (let card = 0; card < 52; ++card) {
      expect(await pool.isCardDrawn(0n, card)).to.equal(true);
    }
  });

  it("increments the nonce while retrying collisions", async function () {
    const { pool } = await networkHelpers.loadFixture(deployCardFixture);

    await pool.drawCardsForTest(0n, 52n, true);

    expect(await pool.getCardNonce(0n)).to.be.greaterThan(52n);
  });

  it("rejects drawing after all 52 cards are used", async function () {
    const { pool } = await networkHelpers.loadFixture(deployCardFixture);
    await pool.drawCardsForTest(0n, 52n, true);

    await expect(
      pool.drawCardsForTest(0n, 1n, false),
    ).to.be.revertedWithCustomError(pool, "DeckExhausted");
  });

  it("rejects drawing before a final seed exists", async function () {
    const { pool } = await networkHelpers.loadFixture(deployCardFixture);
    await pool.createCardTestGame(ethers.ZeroHash);

    await expect(
      pool.drawCardsForTest(1n, 1n, true),
    ).to.be.revertedWithCustomError(pool, "RandomnessNotReady");
  });
});
