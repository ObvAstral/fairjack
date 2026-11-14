import { isError } from "ethers";

const friendlyErrors: Record<string, string> = {
  InvalidSession: "Sessione non valida o sostituita. Apri una nuova sessione.",
  InvalidSessionSignature: "La firma della sessione o della mossa non è valida.",
  InvalidSessionNonce: "Lo stato della sessione è cambiato. Verifica l’operazione in corso e aggiorna la pagina.",
  SessionExpired: "La sessione o la mossa è scaduta. Rinnova la sessione per continuare.",
  SessionBudgetExceeded: "La puntata supera il budget residuo o la puntata massima della sessione.",
  InvalidSessionAction: "Questa operazione non è consentita dalla sessione di gioco.",
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

function errorMessages(error: unknown, seen = new Set<unknown>()): string[] {
  if (typeof error === "string") return [error];
  if (typeof error !== "object" || error === null || seen.has(error)) return [];
  seen.add(error);
  const messages = ["shortMessage", "reason", "message"]
    .map((property) => textProperty(error, property))
    .filter((message): message is string => Boolean(message));
  // Wallets and ethers wrap the RPC error in several different envelopes.
  for (const property of ["error", "info", "data", "cause", "originalError"]) {
    if (property in error)
      messages.push(...errorMessages((error as Record<string, unknown>)[property], seen));
  }
  return messages;
}

export function readableError(error: unknown): string {
  if (isError(error, "ACTION_REJECTED"))
    return "Operazione rifiutata nel wallet.";

  const possibleMessages = errorMessages(error);

  const nonceMessage = possibleMessages.find((message) =>
    /nonce too (high|low)|nonce has already been used/i.test(message),
  );
  if (nonceMessage || isError(error, "NONCE_EXPIRED")) {
    const values = nonceMessage?.match(/expected nonce to be (\d+) but got (\d+)/i);
    const detail = values
      ? `Il wallet usa il nonce ${values[2]}, ma la rete attende ${values[1]}.`
      : "Il nonce del wallet non è sincronizzato con la rete.";
    return `${detail} Se hai riavviato Hardhat Local (31337), seleziona la rete locale e l’account di test nel wallet e cancella i dati di attività e nonce (MetaMask: Settings → Developer tools → Delete activity and nonce data; nelle versioni precedenti: Settings → Advanced → Clear activity and nonce data). Poi ricarica la pagina e riprova.`;
  }

  for (const message of possibleMessages) {
    for (const [name, friendly] of Object.entries(friendlyErrors)) {
      if (new RegExp(`\\b${name}\\b`).test(message)) return friendly;
    }
  }

  return possibleMessages[0] || "Operazione non riuscita.";
}
