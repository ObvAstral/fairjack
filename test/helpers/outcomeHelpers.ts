import { prepareTurn, scoreHand } from "./gameHelpers.js";

export async function reachPlayerWinTurn() {
  return prepareTurn(
    (cards) =>
      scoreHand(cards.slice(0, 2)) === 20 && scoreHand(cards.slice(2)) === 17,
  );
}
export async function reachDealerWinTurn() {
  return prepareTurn(
    (cards) =>
      scoreHand(cards.slice(0, 2)) === 16 && scoreHand(cards.slice(2)) === 20,
  );
}
export async function reachPushTurn() {
  return prepareTurn(
    (cards) =>
      scoreHand(cards.slice(0, 2)) === 18 && scoreHand(cards.slice(2)) === 18,
  );
}
