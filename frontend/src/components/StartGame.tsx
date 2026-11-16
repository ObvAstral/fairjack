import { Contract, formatUnits, parseUnits } from "ethers";
import { useCallback, useState } from "react";
import { fairJackPoolAbi, mockTokenAbi } from "../contracts/abis";
import { contractConfig } from "../config/contracts";
import type { PanelProps } from "../types/wallet";
import {
  confirmTransaction,
  readSnapshot,
  type Confirmation,
} from "../utils/async";
import { useAsyncResource } from "../utils/useAsyncResource";
import { useOperation } from "../utils/useOperation";
import { useGameSession } from "../utils/useGameSession";
import AsyncFeedback from "./AsyncFeedback";

type StartGameProps = PanelProps & {
  onGameStarted: (gameId: bigint, confirmation: Confirmation) => void;
};
export default function StartGame({
  provider,
  signer,
  refreshNonce,
  confirmation,
  onTransactionConfirmed,
  onGameStarted,
}: StartGameProps) {
  const session = useGameSession();
  const [bet, setBet] = useState("25");
  const operation = useOperation();
  const load = useCallback(
    (signal: AbortSignal, confirmed?: Confirmation, minimumBlock?: number) =>
      readSnapshot(
        provider!,
        signal,
        confirmed,
        async (blockTag) => {
          const pool = new Contract(
            contractConfig.poolAddress!,
            fairJackPoolAbi,
            provider!
          );
          const token = new Contract(
            contractConfig.tokenAddress!,
            mockTokenAbi,
            provider!
          );
          const [minimum, maximum, nextGameId, decimals] = await Promise.all([
            pool.MIN_BET({ blockTag }),
            pool.MAX_BET({ blockTag }),
            pool.nextGameId({ blockTag }),
            token.decimals({ blockTag }),
          ]);
          return {
            minimum: minimum as bigint,
            maximum: maximum as bigint,
            nextGameId: nextGameId as bigint,
            decimals: Number(decimals),
          };
        },
        minimumBlock
      ),
    [provider]
  );
  const resource = useAsyncResource(load, refreshNonce, confirmation);
  const data = resource.data;
  const blocked =
    operation.busy ||
    resource.loading ||
    Boolean(resource.error) ||
    !data ||
    session.busy ||
    session.pending ||
    (!session.walletMode && (!session.active || !session.available));
  function start() {
    if (!signer || blocked) return;
    void operation.run(async (progress) => {
      const value = parseUnits(bet, data!.decimals);
      let gameId: bigint, confirmed: Confirmation;
      if (!session.walletMode) {
        progress("Invio tramite relayer…", "submitting");
        const result = await session.send(0, value, progress);
        if (result.gameId === undefined || !result.txHash)
          throw new Error("Evento di creazione partita non trovato.");
        gameId = BigInt(result.gameId);
        confirmed = { txHash: result.txHash };
      } else {
        const pool = new Contract(
          contractConfig.poolAddress!,
          fairJackPoolAbi,
          signer
        );
        progress("Conferma nel wallet…", "wallet");
        const tx = await pool.startPoolGame(value);
        let createdId: bigint | undefined;
        confirmed = await confirmTransaction(tx, progress, (receipt) => {
          const started = receipt.logs
            .map((log) => {
              try {
                return pool.interface.parseLog(log);
              } catch {
                return null;
              }
            })
            .find((event) => event?.name === "PoolGameStarted");
          if (started) createdId = started.args.gameId as bigint;
        });
        if (createdId === undefined)
          throw new Error("Evento di creazione partita non trovato.");
        gameId = createdId;
        onTransactionConfirmed(confirmed);
      }
      progress("Aggiornamento dati…", "syncing");
      onGameStarted(gameId, confirmed);
      const updated = await resource.refresh(confirmed);
      if (updated)
        operation.succeed(`Partita #${gameId} creata. Attesa delle carte.`);
    });
  }
  return (
    <section aria-busy={operation.busy || resource.loading}>
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
          <dd>{data ? `#${data.nextGameId}` : "—"}</dd>
        </div>
        <div>
          <dt>Puntata consentita</dt>
          <dd>
            {data
              ? `${formatUnits(data.minimum, data.decimals)}–${formatUnits(
                  data.maximum,
                  data.decimals
                )} FJT`
              : "—"}
          </dd>
        </div>
      </dl>
      <div className="form-grid single-row">
        <label>
          Puntata FJT
          <input
            value={bet}
            disabled={operation.busy}
            onChange={(event) => setBet(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <button type="button" onClick={start} disabled={!signer || blocked}>
          {operation.busy ? "Creazione…" : "Crea partita"}
        </button>
      </div>
      <p className="hint">
        Richiede allowance, liquidità pari a 2× la puntata e una riserva oracolo
        sufficiente. Il costo VRF è a carico della pool;{" "}
        {session.walletMode
          ? "il gas della transazione è a tuo carico."
          : "il relayer paga il gas delle mosse della sessione."}
      </p>
      <AsyncFeedback operation={operation} resource={resource} />
    </section>
  );
}
