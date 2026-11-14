import { Contract, formatUnits, parseUnits } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { fairJackPoolAbi, mockTokenAbi } from "../contracts/abis";
import { contractConfig } from "../config/contracts";
import type { PanelProps } from "../types/wallet";
import { readableError } from "../utils/errors";
import { useGameSession } from "../utils/useGameSession";

type StartGameProps = PanelProps & {
  onGameStarted: (gameId: bigint) => void;
};

export default function StartGame({
  provider,
  signer,
  refreshNonce,
  onTransactionConfirmed,
  onGameStarted,
}: StartGameProps) {
  const session = useGameSession();
  const [bet, setBet] = useState("25");
  const [decimals, setDecimals] = useState(18);
  const [minimum, setMinimum] = useState(0n);
  const [maximum, setMaximum] = useState(0n);
  const [nextGameId, setNextGameId] = useState(0n);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (
      !provider ||
      !contractConfig.poolAddress ||
      !contractConfig.tokenAddress
    )
      return;
    try {
      const pool = new Contract(
        contractConfig.poolAddress,
        fairJackPoolAbi,
        provider,
      );
      const token = new Contract(
        contractConfig.tokenAddress,
        mockTokenAbi,
        provider,
      );
      const [minBet, maxBet, nextId, tokenDecimals] = await Promise.all([
        pool.MIN_BET(),
        pool.MAX_BET(),
        pool.nextGameId(),
        token.decimals(),
      ]);
      setMinimum(minBet);
      setMaximum(maxBet);
      setNextGameId(nextId);
      setDecimals(Number(tokenDecimals));
      setError(null);
    } catch (cause) {
      setError(readableError(cause));
    }
  }, [provider]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh, refreshNonce]);

  async function start() {
    if (!signer || !contractConfig.poolAddress) return;
    try {
      setPending(true);
      setError(null);
      setSuccess(null);
      if (!session.walletMode) {
        const operation = await session.send(0, parseUnits(bet, decimals));
        if (operation.gameId === undefined) throw new Error("Evento di creazione partita non trovato.");
        const gameId = BigInt(operation.gameId);
        setSuccess(`Partita #${gameId} creata. Il dealer segue le carte.`);
        onGameStarted(gameId);
        onTransactionConfirmed();
        await refresh();
        return;
      }
      const pool = new Contract(
        contractConfig.poolAddress,
        fairJackPoolAbi,
        signer,
      );
      const tx = await pool.startPoolGame(parseUnits(bet, decimals));
      const receipt = await tx.wait();
      const started = receipt?.logs
        .map((log: { topics: readonly string[]; data: string }) => {
          try {
            return pool.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find(
          (event: { name: string } | null) => event?.name === "PoolGameStarted",
        );
      if (!started) throw new Error("Evento di creazione partita non trovato.");
      const gameId = started.args.gameId as bigint;
      setSuccess(
        `Partita #${gameId.toString()} creata. La pool ha richiesto le carte all’oracolo.`,
      );
      onGameStarted(gameId);
      onTransactionConfirmed();
      await refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="step">04</span>
          <h2>Nuova partita</h2>
        </div>
        <p>Blocca la puntata e richiedi le carte.</p>
      </div>
      <dl className="stats compact">
        <div>
          <dt>Prossimo ID</dt>
          <dd>#{nextGameId.toString()}</dd>
        </div>
        <div>
          <dt>Puntata consentita</dt>
          <dd>
            {formatUnits(minimum, decimals)}–{formatUnits(maximum, decimals)}{" "}
            FJT
          </dd>
        </div>
      </dl>
      <div className="form-grid single-row">
        <label>
          Puntata FJT
          <input
            value={bet}
            onChange={(event) => setBet(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <button
          type="button"
          onClick={() => void start()}
          disabled={!signer || pending || session.busy || session.pending || (!session.walletMode && (!session.active || !session.available))}
        >
          {pending ? "Creazione…" : "Crea partita"}
        </button>
      </div>
      <p className="hint">
        Richiede allowance, liquidità pari a 2× la puntata e una riserva oracolo
        sufficiente. Il costo VRF è a carico della pool;{" "}
        {session.walletMode ? "il gas della transazione è a tuo carico." : "il relayer paga il gas delle mosse della sessione."}
      </p>
      {success && <p className="success">{success}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
