import { Contract, hexlify, JsonRpcProvider, randomBytes } from "ethers";
import { useCallback, useEffect, useRef, useState } from "react";
import { contractConfig } from "../config/contracts";
import { fairJackPoolAbi, mockVrfWrapperAbi } from "../contracts/abis";
import {
  activeDeadline,
  randomnessPhaseLabels,
  type GameData,
} from "../types/game";
import type { PanelProps } from "../types/wallet";
import { readableError } from "../utils/errors";
import { cardLabel, formatToken } from "../utils/format";
import ActionButtons from "./ActionButtons";
import GameStatus from "./GameStatus";

type GameBoardProps = PanelProps & {
  selectedGameId: bigint;
  onSelectGame: (gameId: bigint) => void;
};
type Action =
  "hit" | "stand" | "timeout" | "process" | "request" | "fulfill" | "time";
function Hand({
  title,
  cards,
  score,
}: {
  title: string;
  cards: bigint[];
  score: bigint;
}) {
  return (
    <div className="hand">
      <div className="hand-heading">
        <span>{title}</span>
        <strong>{cards.length ? score.toString() : "—"}</strong>
      </div>
      <div className="cards">
        {!cards.length && (
          <span className="empty-hand">Carte non distribuite</span>
        )}
        {cards.map((card, index) => {
          const display = cardLabel(card);
          return (
            <div
              className={`playing-card ${display.red ? "red" : ""}`}
              key={`${card}-${index}`}
              title={`Carta #${card}`}
            >
              <span>{display.label}</span>
              <b>{display.suit}</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}
export default function GameBoard({
  provider,
  signer,
  account,
  chainId,
  refreshNonce,
  onTransactionConfirmed,
  selectedGameId,
  onSelectGame,
}: GameBoardProps) {
  const [gameIdInput, setGameIdInput] = useState(selectedGameId.toString());
  const [game, setGame] = useState<GameData | null>(null);
  const [nextGameId, setNextGameId] = useState(0n);
  const [clock, setClock] = useState({ timestamp: 0, loadedAt: 0 });
  const [now, setNow] = useState(Date.now);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const refreshVersion = useRef(0);
  const refresh = useCallback(async () => {
    if (!provider || !contractConfig.poolAddress) return;
    const version = ++refreshVersion.current;
    try {
      const pool = new Contract(
        contractConfig.poolAddress,
        fairJackPoolAbi,
        provider,
      );
      const count = (await pool.nextGameId()) as bigint;
      if (version !== refreshVersion.current) return;
      setNextGameId(count);
      if (selectedGameId >= count) {
        setGame(null);
        setError(count === 0n ? null : "Partita inesistente.");
        return;
      }
      const [
        core,
        randomness,
        deadline,
        playerCards,
        dealerCards,
        playerScore,
        dealerScore,
        outcome,
        block,
      ] = await Promise.all([
        pool.getGameCore(selectedGameId),
        pool.getGameRandomness(selectedGameId),
        pool.getActionDeadline(selectedGameId),
        pool.getPlayerCards(selectedGameId),
        pool.getDealerCards(selectedGameId),
        pool.getPlayerScore(selectedGameId),
        pool.getDealerScore(selectedGameId),
        pool.getGameResult(selectedGameId),
        provider.getBlock("latest"),
      ]);
      if (version !== refreshVersion.current) return;
      setGame({
        id: selectedGameId,
        player: core.player,
        bet: core.bet,
        maxPayout: core.maxPayout,
        state: Number(core.state),
        result: Number(outcome.result),
        payout: outcome.payout,
        playerCards: [...playerCards],
        dealerCards: [...dealerCards],
        playerScore,
        dealerScore,
        actionDeadline: deadline,
        requestId: randomness.requestId,
        phase: Number(randomness.phase),
        requestCount: randomness.requestCount,
        fulfilled: randomness.fulfilled,
        consumed: randomness.consumed,
        queued: randomness.queued,
        oracleSpent: randomness.oracleSpent,
        oracleBudgetRemaining: randomness.oracleBudgetRemaining,
      });
      if (block) setClock({ timestamp: block.timestamp, loadedAt: Date.now() });
      setError(null);
    } catch (cause) {
      if (version === refreshVersion.current) {
        setGame(null);
        setError(readableError(cause));
      }
    }
  }, [provider, selectedGameId]);
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setGameIdInput(selectedGameId.toString()),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [selectedGameId]);
  useEffect(() => {
    ++refreshVersion.current;
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);
    const poll = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(poll);
    };
  }, [refresh, refreshNonce]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const timestamp =
    clock.timestamp + Math.max(0, Math.floor((now - clock.loadedAt) / 1000));
  const isPlayer = game?.player.toLowerCase() === account?.toLowerCase();
  const deadline = game ? activeDeadline(game) : 0n;
  function chooseGame() {
    try {
      const id = BigInt(gameIdInput);
      if (id < 0n) throw new Error();
      onSelectGame(id);
      setSuccess(null);
    } catch {
      setError("Inserisci un ID partita intero e non negativo.");
    }
  }
  async function transact(action: Action) {
    if (!signer || !game || !contractConfig.poolAddress) return;
    try {
      setPending(action);
      setError(null);
      setSuccess(null);
      const pool = new Contract(
        contractConfig.poolAddress,
        fairJackPoolAbi,
        signer,
      );
      if (action === "time") {
        if (chainId !== 31337n || deadline === 0n)
          throw new Error(
            "Disponibile solo sulla rete locale durante il turno player.",
          );
        const rpc = new JsonRpcProvider(contractConfig.rpcUrl);
        try {
          const block = await rpc.getBlock("latest");
          if (!block) throw new Error("Blocco locale non disponibile.");
          if (BigInt(block.timestamp) <= deadline)
            await rpc.send("evm_setNextBlockTimestamp", [
              Number(deadline + 1n),
            ]);
          await rpc.send("evm_mine", []);
        } finally {
          rpc.destroy();
        }
      } else {
        let tx;
        if (action === "fulfill") {
          if (chainId !== 31337n)
            throw new Error("Il mock è disponibile solo sulla rete locale.");
          const oracle = new Contract(
            await pool.vrfWrapper(),
            mockVrfWrapperAbi,
            signer,
          );
          tx = await oracle.fulfillRandomWords(
            game.requestId,
            BigInt(hexlify(randomBytes(32))),
          );
        } else if (action === "process")
          tx = await pool.processRandomness(game.id);
        else if (action === "request")
          tx = await pool.requestPendingRandomness(game.id);
        else if (action === "timeout") tx = await pool.claimTimeout(game.id);
        else if (action === "hit") tx = await pool.hit(game.id);
        else tx = await pool.stand(game.id);
        await tx.wait();
      }
      setSuccess(
        action === "hit" || action === "stand"
          ? "Scelta registrata. Il tavolo si aggiorna automaticamente durante l’attesa."
          : "Operazione confermata.",
      );
      onTransactionConfirmed();
      await refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setPending(null);
    }
  }
  return (
    <section className="game-section">
      <div className="section-heading">
        <div>
          <span className="step">05</span>
          <h2>Tavolo</h2>
        </div>
        <p>Carte casuali verificate, oracolo pagato dalla pool.</p>
      </div>
      <div className="form-grid single-row">
        <label>
          ID partita
          <input
            value={gameIdInput}
            onChange={(event) => setGameIdInput(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <button type="button" className="secondary" onClick={chooseGame}>
          Apri partita
        </button>
      </div>
      <p className="hint">
        {nextGameId
          ? `${nextGameId} partite create. ID da 0 a ${nextGameId - 1n}.`
          : "Non esistono ancora partite. Creane una dal pannello precedente."}
      </p>
      {game && (
        <>
          <GameStatus game={game} currentTimestamp={timestamp} />
          <div className="table-surface">
            <Hand
              title="Player"
              cards={game.playerCards}
              score={game.playerScore}
            />
            <div className="table-mark">
              <i>FJ</i> BLACKJACK
            </div>
            <Hand
              title="Dealer"
              cards={game.dealerCards}
              score={game.dealerScore}
            />
          </div>
          {game.state === 1 && (
            <p className="hint">
              {game.queued
                ? "Servizio temporaneamente in attesa. La tua scelta è registrata e il tempo di gioco è sospeso. Chiunque può inviare la richiesta appena il servizio torna disponibile."
                : "Attesa della risposta dell’oracolo. Il tempo di gioco è sospeso."}
            </p>
          )}
          {game.state === 2 && (
            <p className="hint">
              Le carte sono pronte. Chiunque può elaborarle; il turno del player
              inizia dopo questa operazione.
            </p>
          )}
          <ActionButtons
            isPlayer={isPlayer}
            state={game.state}
            queued={game.queued}
            pending={pending}
            expired={deadline > 0n && BigInt(timestamp) > deadline}
            localToolsEnabled={chainId === 31337n}
            onAction={(action) => void transact(action)}
            onRefresh={() => void refresh()}
          />
          <details className="oracle-details">
            <summary>Verifica della partita</summary>
            <dl className="stats">
              <div>
                <dt>Fase</dt>
                <dd>{randomnessPhaseLabels[game.phase]}</dd>
              </div>
              <div>
                <dt>Richieste</dt>
                <dd>{game.requestCount.toString()}</dd>
              </div>
              <div>
                <dt>Costo a carico della pool</dt>
                <dd>{formatToken(game.oracleSpent, 18, 8)} ETH</dd>
              </div>
              <div>
                <dt>Budget riservato residuo</dt>
                <dd>{formatToken(game.oracleBudgetRemaining, 18, 8)} ETH</dd>
              </div>
            </dl>
            {!game.queued && (
              <p className="hint" style={{ overflowWrap: "anywhere" }}>
                Request ID: {game.requestId.toString()}
              </p>
            )}
          </details>
        </>
      )}
      {success && <p className="success">{success}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
