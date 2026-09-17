import { isError } from "ethers";

const friendlyErrors: Record<string, string> = {
  ZeroAmount: "L'importo deve essere maggiore di zero.",
  ZeroShares: "Il numero di share deve essere maggiore di zero.",
  ZeroSharesMinted: "L'importo è troppo piccolo per generare una share.",
  ZeroWithdrawalAmount: "Le share indicate non producono un importo prelevabile.",
  InsolventPool: "Il pool non dispone di fondi sufficienti.",
  InsufficientShares: "Non possiedi abbastanza share.",
  InsufficientAvailableLiquidity: "La liquidità libera del pool non è sufficiente.",
  AlreadyRegisteredValidator: "Questo account è già registrato come validator.",
  NotRegisteredValidator: "Questo account non è registrato come validator.",
  InsufficientValidatorCollateral: "Il collateral è inferiore al minimo richiesto.",
  ValidatorHasActiveGames: "Il validator ha ancora partite attive.",
  InsufficientWithdrawableCollateral: "Il collateral libero non è sufficiente.",
  InsufficientEligibleValidators: "Servono almeno tre validator idonei diversi dal player.",
  ValidatorCapacityReached: "Un validator selezionato ha raggiunto la capacità massima.",
  BetBelowMinimum: "La puntata è inferiore al minimo.",
  BetAboveMaximum: "La puntata supera il massimo.",
  InsufficientTokenAllowance: "Allowance insufficiente: autorizza prima il pool.",
  GameDoesNotExist: "La partita indicata non esiste.",
  InvalidGameState: "L'azione non è valida nella fase corrente della partita.",
  GameDeadlinePassed: "La scadenza della fase è già trascorsa.",
  GameDeadlineNotReached: "La scadenza non è ancora trascorsa.",
  TimeoutUnavailable: "Non è possibile reclamare un timeout in questa fase.",
  NotGamePlayer: "Solo il player della partita può eseguire questa azione.",
  NotSelectedValidator: "L'account non fa parte del comitato di questa partita.",
  InvalidCommitment: "Il commitment non è valido.",
  CommitAlreadySubmitted: "Questo account ha già inviato il commit.",
  SecretAlreadyRevealed: "Questo account ha già rivelato il segreto.",
  SecretDoesNotMatchCommit: "Il segreto non corrisponde al commit. Recupera quello originale.",
};

function textProperty(value: unknown, property: string): string | null {
  if (typeof value !== "object" || value === null || !(property in value)) return null;
  const candidate = (value as Record<string, unknown>)[property];
  return typeof candidate === "string" ? candidate : null;
}

export function readableError(error: unknown): string {
  if (isError(error, "ACTION_REJECTED")) return "Operazione rifiutata nel wallet.";

  const possibleMessages = [
    textProperty(error, "shortMessage"),
    textProperty(error, "reason"),
    error instanceof Error ? error.message : null,
  ].filter((message): message is string => Boolean(message));

  for (const message of possibleMessages) {
    for (const [name, friendly] of Object.entries(friendlyErrors)) {
      if (message.includes(name)) return friendly;
    }
  }

  return possibleMessages[0] || "Operazione non riuscita.";
}
