import { Contract, parseEther } from "ethers";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { contractConfig } from "../config/contracts";
import { fairJackPoolAbi, mockTokenAbi } from "../contracts/abis";
import type { WalletState } from "../types/wallet";
import { SessionClient } from "../utils/sessionClient";
import { GameSessionContext } from "../utils/useGameSession";
import {
  confirmTransaction,
  type Confirmation,
  type OperationPhase,
  type Progress,
} from "../utils/async";
import { readableError } from "../utils/errors";

export default function GameSessionProvider({
  wallet,
  onConfirmed,
  children,
}: {
  wallet: WalletState;
  onConfirmed: (confirmation?: Confirmation) => void;
  children: ReactNode;
}) {
  const [initializing, setInitializing] = useState(true);
  const [phase, setPhase] = useState<OperationPhase | null>(null);
  const progressListener = useRef<Progress | undefined>(undefined);
  const mounted = useRef(true);
  const [walletMode, setWalletMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [dealer, setDealer] = useState(false);
  const [, render] = useState(0);
  const lock = useRef(false);
  const revokeLock = useRef(false);
  const [client] = useState(
    () =>
      new SessionClient(
        wallet.provider!,
        wallet.signer!,
        wallet.account!,
        wallet.chainId!,
        contractConfig.poolAddress!
      )
  );
  useEffect(() => {
    let active = true,
      refreshing = false;
    mounted.current = true;
    client.setProgressListener((message, nextPhase) => {
      if (!active) return;
      setStatus(message);
      setPhase(nextPhase);
      progressListener.current?.(message, nextPhase);
    });
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try {
        const config = await client.config();
        await client.refresh();
        if (active) {
          setAvailable(config.available);
          setUnavailable(config.unavailable);
          setDealer(config.dealer && config.available);
          render((n) => n + 1);
        }
      } catch (cause) {
        if (active) {
          setAvailable(false);
          setUnavailable(readableError(cause));
          setDealer(false);
        }
      } finally {
        refreshing = false;
        if (active) setInitializing(false);
      }
    }
    const timer = window.setInterval(() => {
      void refresh();
    }, 4000);
    void refresh();
    return () => {
      active = false;
      mounted.current = false;
      client.setProgressListener(() => {});
      window.clearInterval(timer);
    };
  }, [client]);
  async function run<T>(
    action: () => Promise<T>,
    listener?: Progress
  ): Promise<T> {
    if (lock.current || revokeLock.current)
      throw new Error("Un’operazione è già in corso.");
    lock.current = true;
    progressListener.current = listener;
    setStatus("Preparazione operazione…");
    setPhase("submitting");
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (cause) {
      if (mounted.current) {
        setError(readableError(cause));
        setStatus(null);
      }
      throw cause;
    } finally {
      lock.current = false;
      progressListener.current = undefined;
      if (mounted.current) {
        setBusy(false);
        setPhase(null);
        render((n) => n + 1);
      }
    }
  }
  const session = client.session;
  return (
    <GameSessionContext.Provider
      value={{
        initializing,
        phase,
        walletMode,
        setWalletMode,
        active: session !== null,
        busy: busy || revoking,
        revoking,
        pending: client.pending !== null,
        status,
        error,
        available,
        unavailable,
        dealer,
        remaining: session?.remaining ?? 0n,
        maxBet: session?.maxBet ?? 0n,
        expiresAt: session?.validUntil ?? 0,
        secondsLeft: client.secondsLeft,
        open: async (budgetText, maxBetText) => {
          await run(async () => {
            const budget = parseEther(budgetText),
              maxBet = parseEther(maxBetText);
            if (
              budget < maxBet ||
              maxBet < parseEther("1") ||
              maxBet > parseEther("100")
            )
              throw new Error(
                "Scegli una puntata massima tra 1 e 100 FJT e un budget almeno pari alla puntata massima."
              );
            const config = await client.config();
            if (!config.available)
              throw new Error(config.unavailable || "Relayer non disponibile.");
            if (budget > BigInt(config.maxSessionBudget))
              throw new Error("Budget oltre il limite sponsorizzato.");
            const token = new Contract(
              contractConfig.tokenAddress!,
              mockTokenAbi,
              wallet.signer!
            );
            if (
              (await token.allowance(
                wallet.account,
                contractConfig.poolAddress
              )) < budget
            ) {
              setStatus(
                "Autorizza i FJT nel wallet. Il gas dell’approve è a tuo carico."
              );
              setPhase("wallet");
              const approved = await confirmTransaction(
                await token.approve(contractConfig.poolAddress, budget),
                (message, nextPhase) => {
                  setStatus(message);
                  setPhase(nextPhase);
                }
              );
              onConfirmed(approved);
            }
            const operation = await client.register(budget, maxBet);
            const confirmed = operation.txHash
              ? { txHash: operation.txHash }
              : undefined;
            onConfirmed(confirmed);
            if (mounted.current) {
              setWalletMode(false);
              setStatus(
                "Sessione attiva. Le mosse non richiedono conferme del wallet."
              );
            }
          }).catch(() => {});
        },
        revoke: async () => {
          // Owner revocation must remain usable even if a relayed operation is
          // pending or the backend has gone offline.
          if (revokeLock.current) return;
          revokeLock.current = true;
          setRevoking(true);
          setError(null);
          try {
            const pool = new Contract(
              contractConfig.poolAddress!,
              fairJackPoolAbi,
              wallet.signer!
            );
            const id = await pool.activeSession(wallet.account);
            if (BigInt(id) === 0n)
              throw new Error("Nessuna sessione attiva da revocare.");
            setStatus("Conferma la revoca nel wallet; il gas è a tuo carico.");
            setPhase("wallet");
            const confirmed = await confirmTransaction(
              await pool.revokeSession(id),
              (message, nextPhase) => {
                setStatus(message);
                setPhase(nextPhase);
              }
            );
            onConfirmed(confirmed);
            client.forgetSession();
            setStatus(
              "Sessione revocata. Se un invio resta incerto, verifica l’operazione o ricarica la pagina."
            );
          } catch (cause) {
            if (mounted.current) {
              setError(readableError(cause));
              setStatus(null);
            }
          } finally {
            revokeLock.current = false;
            if (mounted.current) {
              setRevoking(false);
              if (!lock.current) setPhase(null);
              render((n) => n + 1);
            }
          }
        },
        resume: async () => {
          await run(async () => {
            const operation = await client.resume();
            setStatus(
              operation.gameId
                ? `Partita #${operation.gameId} confermata. Aprila dal tavolo.`
                : "Operazione confermata."
            );
            onConfirmed(
              operation.txHash ? { txHash: operation.txHash } : undefined
            );
          }).catch(() => {});
        },
        send: (kind, argument, progress) =>
          run(async () => {
            const operation = await client.send(kind, argument);
            setStatus(
              "Mossa confermata. Il dealer segue la risposta dell’oracolo."
            );
            onConfirmed(
              operation.txHash ? { txHash: operation.txHash } : undefined
            );
            return operation;
          }, progress),
      }}
    >
      {children}
    </GameSessionContext.Provider>
  );
}
