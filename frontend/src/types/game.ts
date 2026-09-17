export type ValidatorRandomness = {
  address: string;
  commitment: string;
  committed: boolean;
  revealed: boolean;
};

export type GameData = {
  id: bigint;
  player: string;
  bet: bigint;
  maxPayout: bigint;
  state: number;
  result: number;
  payout: bigint;
  validators: ValidatorRandomness[];
  playerCards: bigint[];
  dealerCards: bigint[];
  playerScore: bigint;
  dealerScore: bigint;
  playerCommit: string;
  playerCommitted: boolean;
  playerRevealed: boolean;
  commitCount: number;
  revealCount: number;
  finalSeed: string;
  commitDeadline: bigint;
  revealDeadline: bigint;
  actionDeadline: bigint;
};

export const gameStateLabels = [
  "Creata",
  "Attesa commit",
  "Attesa reveal",
  "Turno player",
  "Turno dealer",
  "Conclusa",
  "Annullata",
] as const;

export const gameResultLabels = ["Nessuno", "Vittoria player", "Vittoria banco", "Push"] as const;

export function activeDeadline(game: GameData) {
  if (game.state === 1) return game.commitDeadline;
  if (game.state === 2) return game.revealDeadline;
  if (game.state === 3) return game.actionDeadline;
  return 0n;
}
