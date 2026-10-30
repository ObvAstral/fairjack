export type GameData = {
  id: bigint;
  player: string;
  bet: bigint;
  maxPayout: bigint;
  state: number;
  result: number;
  payout: bigint;
  playerCards: bigint[];
  dealerCards: bigint[];
  playerScore: bigint;
  dealerScore: bigint;
  actionDeadline: bigint;
  requestId: bigint;
  phase: number;
  requestCount: bigint;
  fulfilled: boolean;
  consumed: boolean;
  queued: boolean;
  oracleSpent: bigint;
  oracleBudgetRemaining: bigint;
};
export const gameStateLabels = [
  "Creata",
  "Attesa oracolo",
  "Carte pronte",
  "Turno player",
  "Turno dealer",
  "Conclusa",
] as const;
export const gameResultLabels = [
  "Nessuno",
  "Vittoria player",
  "Vittoria banco",
  "Push",
] as const;
export const randomnessPhaseLabels = [
  "Distribuzione iniziale",
  "Hit del player",
  "Pescata del dealer",
] as const;
export function activeDeadline(game: GameData) {
  return game.state === 3 ? game.actionDeadline : 0n;
}
