import { Contract, hexlify, JsonRpcProvider, randomBytes } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { contractConfig } from "../config/contracts";
import { fairJackPoolAbi, mockVrfWrapperAbi } from "../contracts/abis";
import {
  activeDeadline,
  randomnessPhaseLabels,
  type GameData,
} from "../types/game";
import type { PanelProps } from "../types/wallet";
import {
  chainTimestamp,
  syncChainClock,
  type ChainClock,
} from "../utils/chainClock";
import {
  confirmTransaction,
  readSnapshot,
  type Confirmation,
} from "../utils/async";
import { useAsyncResource } from "../utils/useAsyncResource";
import { useOperation } from "../utils/useOperation";
import { useGameSession } from "../utils/useGameSession";
import { cardLabel, formatToken } from "../utils/format";
import ActionButtons from "./ActionButtons";
import GameStatus from "./GameStatus";
import AsyncFeedback from "./AsyncFeedback";
import LoadingStatus from "./LoadingStatus";

type GameBoardProps = PanelProps & {
  selectedGameId: bigint;
  selectionRevision?: number;
  selectionExplicit?: boolean;
  onSelectGame: (gameId: bigint) => void;
};
type Action =
  | "hit"
  | "stand"
  | "timeout"
  | "process"
  | "request"
  | "fulfill"
  | "time";
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
  confirmation,
  onTransactionConfirmed,
  selectedGameId,
  selectionRevision = 0,
  selectionExplicit = false,
  onSelectGame,
}: GameBoardProps) {
  const session = useGameSession();
  const [gameIdInput, setGameIdInput] = useState(selectedGameId.toString());
  const [inputError, setInputError] = useState<string | null>(null);
  const [clock, setClock] = useState<ChainClock | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const [pending, setPending] = useState<Action | null>(null);
  const operation = useOperation();
  const selectionKey = `${selectedGameId}:${selectionRevision}`;
  const [feedbackSelection, setFeedbackSelection] = useState(selectionKey);
  const visibleOperation =
    operation.busy || feedbackSelection === selectionKey
      ? operation
      : undefined;
  const load = useCallback(
    (signal: AbortSignal, confirmed?: Confirmation, minimumBlock?: number) =>
      readSnapshot(
        provider!,
        signal,
        confirmed,
        async (blockTag) => {
          // A new revision deliberately reloads even when opening the same game ID.
          void selectionRevision;
          const pool = new Contract(
            contractConfig.poolAddress!,
            fairJackPoolAbi,
            provider!
          );
          const count = (await pool.nextGameId({ blockTag })) as bigint;
          if (selectedGameId >= count)
            return {
              game: null,
              count,
              block: null,
              missing: selectionExplicit || count > 0n,
            };
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
            pool.getGameCore(selectedGameId, { blockTag }),
            pool.getGameRandomness(selectedGameId, { blockTag }),
            pool.getActionDeadline(selectedGameId, { blockTag }),
            pool.getPlayerCards(selectedGameId, { blockTag }),
            pool.getDealerCards(selectedGameId, { blockTag }),
            pool.getPlayerScore(selectedGameId, { blockTag }),
            pool.getDealerScore(selectedGameId, { blockTag }),
            pool.getGameResult(selectedGameId, { blockTag }),
            provider!.getBlock(blockTag),
          ]);
          const game: GameData = {
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
          };
          return { game, count, block, missing: false };
        },
        minimumBlock
      ),
    [provider, selectedGameId, selectionRevision, selectionExplicit]
  );
  const resource = useAsyncResource(load, refreshNonce, confirmation, 4000);
  const game = resource.data?.game ?? null;
  const nextGameId = resource.data?.count ?? 0n;
  const block = resource.data?.block;
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setGameIdInput(selectedGameId.toString());
      setInputError(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedGameId, selectionRevision]);
  useEffect(() => {
    if (!block) return;
    const loadedAt = performance.now();
    const timer = window.setTimeout(
      () => setClock((previous) => syncChainClock(previous, block, loadedAt)),
      0
    );
    return () => window.clearTimeout(timer);
  }, [block]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const timestamp =
    clock && block?.hash === clock.blockHash
      ? chainTimestamp(clock, now)
      : block?.timestamp ?? 0;
  const isPlayer = game?.player.toLowerCase() === account?.toLowerCase();
  const deadline = game ? activeDeadline(game) : 0n;
  function chooseGame() {
    if (operation.busy) return;
    try {
      if (!/^\d+$/.test(gameIdInput.trim())) throw new Error();
      onSelectGame(BigInt(gameIdInput));
      setInputError(null);
    } catch {
      setInputError("Inserisci un ID partita intero e non negativo.");
    }
  }
  function transact(action: Action) {
    if (
      !signer ||
      !game ||
      resource.loading ||
      resource.error ||
      operation.busy ||
      session.busy ||
      session.pending
    )
      return;
    void operation.run(async (progress) => {
      setFeedbackSelection(selectionKey);
      setPending(action);
      let confirmed: Confirmation | undefined;
      if ((action === "hit" || action === "stand") && !session.walletMode) {
        progress("Invio tramite relayer…", "submitting");
        const result = await session.send(
          action === "hit" ? 1 : 2,
          game.id,
          progress
        );
        if (result.txHash) confirmed = { txHash: result.txHash };
      } else if (action === "time") {
        if (chainId !== 31337n || deadline === 0n)
          throw new Error(
            "Disponibile solo sulla rete locale durante il turno player."
          );
        progress("Aggiornamento rete locale…", "submitting");
        const rpc = new JsonRpcProvider(contractConfig.rpcUrl);
        try {
          const latest = await rpc.getBlock("latest");
          if (!latest) throw new Error("Blocco locale non disponibile.");
          if (BigInt(latest.timestamp) <= deadline)
            await rpc.send("evm_setNextBlockTimestamp", [
              Number(deadline + 1n),
            ]);
          await rpc.send("evm_mine", []);
        } finally {
          rpc.destroy();
        }
      } else {
        const pool = new Contract(
          contractConfig.poolAddress!,
          fairJackPoolAbi,
          signer
        );
        progress("Conferma nel wallet…", "wallet");
        let tx;
        if (action === "fulfill") {
          if (chainId !== 31337n)
            throw new Error("Il mock è disponibile solo sulla rete locale.");
          const oracle = new Contract(
            await pool.vrfWrapper(),
            mockVrfWrapperAbi,
            signer
          );
          tx = await oracle.fulfillRandomWords(
            game.requestId,
            BigInt(hexlify(randomBytes(32)))
          );
        } else if (action === "process")
          tx = await pool.processRandomness(game.id);
        else if (action === "request")
          tx = await pool.requestPendingRandomness(game.id);
        else if (action === "timeout") tx = await pool.claimTimeout(game.id);
        else if (action === "hit") tx = await pool.hit(game.id);
        else tx = await pool.stand(game.id);
        confirmed = await confirmTransaction(tx, progress);
      }
      progress("Aggiornamento partita…", "syncing");
      const updated = await resource.refresh(confirmed);
      if (session.walletMode || (action !== "hit" && action !== "stand"))
        onTransactionConfirmed(confirmed);
      if (updated) operation.succeed("Operazione confermata.");
    });
  }
  return (
    <section
      className="game-section"
      aria-busy={operation.busy || resource.loading}
    >
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
            disabled={operation.busy}
            onChange={(event) => setGameIdInput(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <button
          type="button"
          className="secondary"
          onClick={chooseGame}
          disabled={operation.busy}
        >
          Apri partita
        </button>
      </div>
      {resource.data && (
        <p className="hint">
          {nextGameId
            ? `${nextGameId} partite create. ID da 0 a ${nextGameId - 1n}.`
            : "Non esistono ancora partite. Creane una dal pannello precedente."}
        </p>
      )}
      {inputError && (
        <p className="error" role="alert">
          {inputError}
        </p>
      )}
      {resource.data?.missing && (
        <p className="error" role="alert">
          Partita inesistente.
        </p>
      )}
      <AsyncFeedback
        operation={visibleOperation}
        resource={resource}
        loadingMessage={
          game ? "Aggiornamento partita…" : "Caricamento partita…"
        }
      />
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
            <LoadingStatus>
              {game.queued
                ? "Servizio temporaneamente in attesa. La scelta è registrata e il tempo di gioco è sospeso."
                : "Attesa della risposta dell’oracolo. Il tempo di gioco è sospeso."}
            </LoadingStatus>
          )}
          {game.state === 2 &&
            (session.dealer && !session.walletMode ? (
              <LoadingStatus>
                Le carte sono pronte. Il dealer sta elaborando la risposta…
              </LoadingStatus>
            ) : (
              <p className="hint">
                Le carte sono pronte. Elabora la risposta dal wallet per
                iniziare il turno.
              </p>
            ))}
          <ActionButtons
            isPlayer={isPlayer}
            state={game.state}
            queued={game.queued}
            pending={
              operation.busy
                ? pending
                : resource.loading || resource.error
                ? "refresh"
                : session.busy || session.pending
                ? "session"
                : null
            }
            sessionBlocked={
              !session.walletMode && (!session.active || !session.available)
            }
            automatic={session.dealer && !session.walletMode}
            expired={deadline > 0n && BigInt(timestamp) > deadline}
            localToolsEnabled={chainId === 31337n}
            onAction={(action) => void transact(action)}
            onRefresh={() => void resource.refresh()}
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
    </section>
  );
}
