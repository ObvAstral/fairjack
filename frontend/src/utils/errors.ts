import { isError } from "ethers";

const friendlyErrors: Record<string, string> = {
  InsufficientOracleReserve:
    "La riserva ETH libera della pool non copre il budget per una nuova partita.",
  OracleUnavailable:
    "L’oracolo è temporaneamente indisponibile o il costo supera il limite della pool.",
  NoQueuedRandomness: "La richiesta è già stata inviata all’oracolo.",
  RandomnessNotReady: "La risposta dell’oracolo non è ancora pronta.",
  ZeroAmount: "L'importo deve essere maggiore di zero.",
  ZeroShares: "Il numero di share deve essere maggiore di zero.",
  ZeroSharesMinted: "L'importo è troppo piccolo per generare una share.",
  ZeroWithdrawalAmount:
    "Le share indicate non producono un importo prelevabile.",
  ActiveGamesPreventShareChanges:
    "Attendi la conclusione delle partite attive per depositare o ritirare FJT: il valore delle share è protetto durante il gioco.",
  InsolventPool: "Il pool non dispone di fondi sufficienti.",
  InsufficientShares: "Non possiedi abbastanza share.",
  InsufficientAvailableLiquidity:
    "La liquidità libera del pool non è sufficiente.",
  BetBelowMinimum: "La puntata è inferiore al minimo.",
  BetAboveMaximum: "La puntata supera il massimo.",
  InsufficientTokenAllowance:
    "Allowance insufficiente: autorizza prima il pool.",
  GameDoesNotExist: "La partita indicata non esiste.",
  InvalidGameState: "L'azione non è valida nella fase corrente della partita.",
  GameDeadlinePassed: "La scadenza della fase è già trascorsa.",
  GameDeadlineNotReached: "La scadenza non è ancora trascorsa.",
  TimeoutUnavailable: "Non è possibile reclamare un timeout in questa fase.",
  NotGamePlayer: "Solo il player della partita può eseguire questa azione.",
};

function textProperty(value: unknown, property: string): string | null {
  if (typeof value !== "object" || value === null || !(property in value))
    return null;
  const candidate = (value as Record<string, unknown>)[property];
  return typeof candidate === "string" ? candidate : null;
}

export function readableError(error: unknown): string {
  if (isError(error, "ACTION_REJECTED"))
    return "Operazione rifiutata nel wallet.";

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
