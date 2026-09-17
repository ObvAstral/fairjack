import { Contract, JsonRpcProvider, ZeroHash } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import { contractConfig } from "../config/contracts";
import { fairJackPoolAbi } from "../contracts/abis";
import { activeDeadline, type GameData, type ValidatorRandomness } from "../types/game";
import type { PanelProps } from "../types/wallet";
import { readableError } from "../utils/errors";
import { cardLabel, shortAddress } from "../utils/format";
import { createSecret, isValidSecret, loadSecret, saveSecret } from "../utils/secrets";
import ActionButtons from "./ActionButtons";
import GameStatus from "./GameStatus";

type GameBoardProps = PanelProps & {
  selectedGameId: bigint;
  onSelectGame: (gameId: bigint) => void;
};

type ChainClock = { timestamp: number; loadedAt: number };

function Hand({ title, cards, score }: { title: string; cards: bigint[]; score: bigint }) {
  return (
    <div className="hand">
      <div className="hand-heading"><span>{title}</span><strong>{cards.length ? score.toString() : "—"}</strong></div>
      <div className="cards">
        {cards.length === 0 && <span className="empty-hand">Carte non distribuite</span>}
        {cards.map((card, index) => {
          const display = cardLabel(card);
          return (
            <div className={`playing-card ${display.red ? "red" : ""}`} key={`${card}-${index}`} title={`Carta #${card.toString()}`}>
              <span>{display.label}</span><b>{display.suit}</b>
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
  const [secret, setSecret] = useState("");
  const [chainClock, setChainClock] = useState<ChainClock>({ timestamp: 0, loadedAt: 0 });
  const [nowTick, setNowTick] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!provider || !contractConfig.poolAddress) return;
    try {
      const pool = new Contract(contractConfig.poolAddress, fairJackPoolAbi, provider);
      const gameCount = await pool.nextGameId() as bigint;
      setNextGameId(gameCount);
      if (selectedGameId >= gameCount) {
        setGame(null);
        setError(gameCount === 0n
          ? "Non esistono ancora partite. Creane una dal pannello precedente."
          : `Partita inesistente. Gli ID disponibili vanno da 0 a ${(gameCount - 1n).toString()}.`);
        return;
      }

      const [core, validators, deadlines, randomness, playerCards, dealerCards, playerScore, dealerScore, outcome, latestBlock] = await Promise.all([
        pool.getGameCore(selectedGameId),
        pool.getGameValidators(selectedGameId),
        pool.getGameDeadlines(selectedGameId),
        pool.getGameRandomnessProgress(selectedGameId),
        pool.getPlayerCards(selectedGameId),
        pool.getDealerCards(selectedGameId),
        pool.getPlayerScore(selectedGameId),
        pool.getDealerScore(selectedGameId),
        pool.getGameResult(selectedGameId),
        provider.getBlock("latest"),
      ]);
      const validatorStatuses: ValidatorRandomness[] = await Promise.all(
        (validators as string[]).map(async (address) => {
          const status = await pool.getValidatorRandomnessStatus(selectedGameId, address);
          return {
            address,
            commitment: status.commitment,
            committed: status.committed,
            revealed: status.revealed,
          };
        }),
      );
      setGame({
        id: selectedGameId,
        player: core.player,
        bet: core.bet,
        maxPayout: core.maxPayout,
        state: Number(core.state),
        result: Number(outcome.result),
        payout: outcome.payout,
        validators: validatorStatuses,
        playerCards: [...playerCards],
        dealerCards: [...dealerCards],
        playerScore,
        dealerScore,
        playerCommit: randomness.playerCommit,
        playerCommitted: randomness.playerCommitted,
        playerRevealed: randomness.playerRevealed,
        commitCount: Number(randomness.commitCount),
        revealCount: Number(randomness.revealCount),
        finalSeed: randomness.finalSeed,
        commitDeadline: deadlines.commitDeadline,
        revealDeadline: deadlines.revealDeadline,
        actionDeadline: deadlines.actionDeadline,
      });
      if (latestBlock) setChainClock({ timestamp: latestBlock.timestamp, loadedAt: Date.now() });
      setError(null);
    } catch (cause) {
      setGame(null);
      setError(readableError(cause));
    }
  }, [provider, selectedGameId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setGameIdInput(selectedGameId.toString()), 0);
    return () => window.clearTimeout(timeout);
  }, [selectedGameId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh, refreshNonce]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!account || !chainId || !contractConfig.poolAddress) {
        setSecret("");
        return;
      }
      setSecret(loadSecret(chainId, contractConfig.poolAddress, selectedGameId, account));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [account, chainId, selectedGameId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const currentTimestamp = useMemo(
    () => chainClock.timestamp + Math.floor((nowTick - chainClock.loadedAt) / 1000),
    [chainClock, nowTick],
  );

  const normalizedAccount = account?.toLowerCase();
  const validatorStatus = game?.validators.find((validator) => validator.address.toLowerCase() === normalizedAccount);
  const role = game && normalizedAccount === game.player.toLowerCase()
    ? "player"
    : validatorStatus
      ? "validator"
      : "observer";
  const committed = role === "player" ? Boolean(game?.playerCommitted) : Boolean(validatorStatus?.committed);
  const revealed = role === "player" ? Boolean(game?.playerRevealed) : Boolean(validatorStatus?.revealed);
  const deadline = game ? activeDeadline(game) : 0n;

  function storeSecret(value: string) {
    setSecret(value);
    if (isValidSecret(value) && account && chainId && contractConfig.poolAddress) {
      saveSecret(chainId, contractConfig.poolAddress, selectedGameId, account, value);
    }
  }

  function chooseGame() {
    try {
      const parsed = BigInt(gameIdInput);
      if (parsed < 0n) throw new Error();
      onSelectGame(parsed);
    } catch {
      setError("Inserisci un ID partita intero e non negativo.");
    }
  }

  async function transact(action: "commit" | "reveal" | "hit" | "stand" | "timeout") {
    if (!signer || !account || !game || !contractConfig.poolAddress) return;
    try {
      setPending(action);
      setError(null);
      setSuccess(null);
      const pool = new Contract(contractConfig.poolAddress, fairJackPoolAbi, signer);
      let tx;
      if (action === "commit") {
        if (!isValidSecret(secret)) throw new Error("Il segreto deve essere un bytes32 (0x + 64 caratteri esadecimali).");
        if (chainId) saveSecret(chainId, contractConfig.poolAddress, game.id, account, secret);
        const commitment = await pool.computeCommitment(secret, game.id, account);
        tx = role === "player"
          ? await pool.submitPlayerCommit(game.id, commitment)
          : await pool.submitValidatorCommit(game.id, commitment);
      } else if (action === "reveal") {
        if (!isValidSecret(secret)) throw new Error("Manca il segreto bytes32 usato per il commit.");
        tx = role === "player"
          ? await pool.revealPlayerSecret(game.id, secret)
          : await pool.revealValidatorSecret(game.id, secret);
      } else if (action === "hit") {
        tx = await pool.hit(game.id);
      } else if (action === "stand") {
        tx = await pool.stand(game.id);
      } else {
        tx = await pool.claimTimeout(game.id);
      }
      await tx.wait();
      setSuccess("Transazione confermata.");
      onTransactionConfirmed();
      await refresh();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setPending(null);
    }
  }

  async function advanceTime() {
    if (!game || deadline === 0n) return;
    try {
      setPending("time");
      setError(null);
      setSuccess(null);
      const localProvider = new JsonRpcProvider(contractConfig.rpcUrl);
      const block = await localProvider.getBlock("latest");
      if (!block) throw new Error("Impossibile leggere l'ultimo blocco locale.");
      if (BigInt(block.timestamp) <= deadline) {
        await localProvider.send("evm_setNextBlockTimestamp", [Number(deadline + 1n)]);
      }
      await localProvider.send("evm_mine", []);
      localProvider.destroy();
      setSuccess("La chain locale è ora oltre la deadline. Puoi reclamare il timeout.");
      await refresh();
    } catch (cause) {
      setError(`Tool locale: ${readableError(cause)}`);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="game-section">
      <div className="section-heading"><div><span className="step">05</span><h2>Tavolo e protocollo</h2></div><p>Commit/reveal, gioco, payout e timeout.</p></div>
      <div className="game-picker">
        <label>ID partita
          <input value={gameIdInput} onChange={(event) => setGameIdInput(event.target.value)} inputMode="numeric" />
        </label>
        <button type="button" className="secondary" onClick={chooseGame}>Carica</button>
        <button type="button" className="secondary" onClick={() => nextGameId > 0n && onSelectGame(nextGameId - 1n)} disabled={nextGameId === 0n}>Ultima</button>
        <span>{nextGameId.toString()} partite totali</span>
      </div>

      {game && (
        <>
          <GameStatus game={game} currentTimestamp={currentTimestamp} />

          <div className="table-surface">
            <Hand title="Dealer" cards={game.dealerCards} score={game.dealerScore} />
            <div className="table-mark"><span>FAIR</span><i>◆</i><span>JACK</span></div>
            <Hand title="Player" cards={game.playerCards} score={game.playerScore} />
          </div>

          <div className="committee">
            <h3>Partecipanti commit / reveal</h3>
            <div className="participant-list">
              <div className={role === "player" ? "current" : ""}>
                <span>Player · {shortAddress(game.player)}</span>
                <b className={game.playerCommitted ? "done" : ""}>{game.playerCommitted ? "Commit ✓" : "Commit —"}</b>
                <b className={game.playerRevealed ? "done" : ""}>{game.playerRevealed ? "Reveal ✓" : "Reveal —"}</b>
              </div>
              {game.validators.map((validator, index) => (
                <div className={validator.address.toLowerCase() === normalizedAccount ? "current" : ""} key={validator.address}>
                  <span>V{index + 1} · {shortAddress(validator.address)}</span>
                  <b className={validator.committed ? "done" : ""}>{validator.committed ? "Commit ✓" : "Commit —"}</b>
                  <b className={validator.revealed ? "done" : ""}>{validator.revealed ? "Reveal ✓" : "Reveal —"}</b>
                </div>
              ))}
            </div>
          </div>

          {role !== "observer" && [1, 2].includes(game.state) && (
            <div className="secret-panel">
              <div>
                <h3>Segreto locale · ruolo {role}</h3>
                <p>È salvato solo in questo browser per chain, partita e account. Non perderlo prima del reveal.</p>
              </div>
              <label>bytes32
                <input className="mono-input" value={secret} onChange={(event) => storeSecret(event.target.value.trim())} placeholder="0x…" spellCheck={false} />
              </label>
              <div className="actions">
                <button type="button" className="secondary" onClick={() => storeSecret(createSecret())}>Genera nuovo</button>
                <button type="button" className="secondary" onClick={() => void navigator.clipboard.writeText(secret)} disabled={!isValidSecret(secret)}>Copia</button>
              </div>
              {committed && !isValidSecret(secret) && <p className="error">Il commit esiste ma il segreto non è presente in questo browser/account. Incolla quello originale.</p>}
            </div>
          )}

          {game.finalSeed !== ZeroHash && <p className="seed"><span>Final seed</span><code>{game.finalSeed}</code></p>}

          <ActionButtons
            role={role}
            state={game.state}
            committed={committed}
            revealed={revealed}
            secretValid={isValidSecret(secret)}
            pending={pending}
            localToolsEnabled={chainId === 31337n}
            hasDeadline={deadline > 0n}
            onCommit={() => void transact("commit")}
            onReveal={() => void transact("reveal")}
            onHit={() => void transact("hit")}
            onStand={() => void transact("stand")}
            onClaimTimeout={() => void transact("timeout")}
            onAdvanceTime={() => void advanceTime()}
            onRefresh={() => void refresh()}
          />
          <p className="role-note">Account corrente: <strong>{role}</strong>. Il claim timeout è intenzionalmente disponibile anche prima della scadenza per verificare il revert del contratto.</p>
        </>
      )}

      {success && <p className="success">{success}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
