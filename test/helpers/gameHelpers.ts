import { deployFixture, ORACLE_FUNDING, ethers } from "./deployFixture.js";

export const TEST_POOL_DEPOSIT = ethers.parseEther("1000");
export const TEST_BET = ethers.parseEther("25");
export type GameFixture = Awaited<ReturnType<typeof deployFixture>>;

export async function createPool() {
  const f = await deployFixture();
  await f.pool.connect(f.staker).depositToHousePool(TEST_POOL_DEPOSIT);
  await f.pool.connect(f.staker).fundOracle({ value: ORACLE_FUNDING });
  return f;
}
export async function createGame() {
  const f = await createPool();
  await f.pool.connect(f.player).startPoolGame(TEST_BET);
  return f;
}
export function scoreHand(cards: readonly bigint[]): number {
  let score = 0,
    aces = 0;
  for (const card of cards) {
    const rank = Number(card) % 13;
    if (rank === 0) {
      score += 11;
      ++aces;
    } else score += Math.min(rank + 1, 10);
  }
  while (score > 21 && aces > 0) {
    score -= 10;
    --aces;
  }
  return score;
}

// Independent full-array shuffle model (production uses sparse encoded slots).
export function drawPhase(
  f: GameFixture,
  gameId: bigint,
  requestId: bigint,
  word: bigint,
  seen: readonly bigint[],
  count: number,
): bigint[] {
  const deck = Array.from({ length: 52 }, (_, i) => BigInt(i));
  for (const card of seen) {
    const index = deck.indexOf(card);
    if (index < 0) throw new Error("Duplicate prior card");
    deck[index] = deck[deck.length - 1];
    deck.pop();
  }
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const seed = ethers.keccak256(
    coder.encode(
      ["uint256", "address", "uint256", "uint256", "uint256"],
      [f.chainId, f.pool.target, gameId, requestId, word],
    ),
  );
  const result: bigint[] = [];
  for (let nonce = 0; nonce < count; ++nonce) {
    const hash = ethers.keccak256(
      coder.encode(["bytes32", "uint256"], [seed, nonce]),
    );
    const index = Number(BigInt(hash) % BigInt(deck.length));
    result.push(deck[index]);
    deck[index] = deck[deck.length - 1];
    deck.pop();
  }
  return result;
}
export function findWord(
  f: GameFixture,
  gameId: bigint,
  requestId: bigint,
  seen: readonly bigint[],
  count: number,
  predicate: (cards: bigint[]) => boolean,
) {
  for (let word = 0n; word < 20000n; ++word) {
    const cards = drawPhase(f, gameId, requestId, word, seen, count);
    if (predicate(cards)) return { word, cards };
  }
  throw new Error("No test oracle word satisfies predicate");
}
export async function fulfillAndProcess(
  f: GameFixture,
  gameId = 0n,
  word = 1n,
) {
  const progress = await f.pool.getGameRandomness(gameId);
  const fulfillment = await f.oracle.fulfillRandomWords(
    progress.requestId,
    word,
  );
  const processing = await f.pool.connect(f.outsider).processRandomness(gameId);
  return { fulfillment, processing };
}
export async function prepareTurn(predicate: (cards: bigint[]) => boolean) {
  const f = await createGame();
  const { requestId } = await f.pool.getGameRandomness(0n);
  const { word, cards } = findWord(f, 0n, requestId, [], 4, predicate);
  await fulfillAndProcess(f, 0n, word);
  return { ...f, initialWord: word, initialCards: cards };
}
export async function reachPlayerTurn() {
  return prepareTurn(
    (cards) =>
      scoreHand(cards.slice(0, 2)) === 16 && scoreHand(cards.slice(2)) < 17,
  );
}
export async function resolveStand(f: GameFixture, gameId = 0n, word = 7n) {
  await f.pool.connect(f.player).stand(gameId);
  if ((await f.pool.getGameCore(gameId)).state === 1n)
    await fulfillAndProcess(f, gameId, word);
}
