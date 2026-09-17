import type { GameData } from "../types/game";
import { activeDeadline, gameResultLabels, gameStateLabels } from "../types/game";
import { formatDuration, formatTimestamp, formatToken, shortAddress } from "../utils/format";

type GameStatusProps = {
  game: GameData;
  currentTimestamp: number;
};

export default function GameStatus({ game, currentTimestamp }: GameStatusProps) {
  const deadline = activeDeadline(game);
  const remaining = Number(deadline) - currentTimestamp;
  const expired = deadline > 0n && remaining < 0;

  return (
    <div className="game-status">
      <div className="game-title-row">
        <div>
          <span className="eyebrow">Partita #{game.id.toString()}</span>
          <h2>{gameStateLabels[game.state] ?? `Stato ${game.state}`}</h2>
        </div>
        <span className={`phase-badge state-${game.state}`}>{gameStateLabels[game.state] ?? game.state}</span>
      </div>

      <dl className="stats game-core-stats">
        <div><dt>Player</dt><dd title={game.player}>{shortAddress(game.player)}</dd></div>
        <div><dt>Puntata</dt><dd>{formatToken(game.bet)} FJT</dd></div>
        <div><dt>Payout massimo</dt><dd>{formatToken(game.maxPayout)} FJT</dd></div>
        <div><dt>Esito</dt><dd>{gameResultLabels[game.result] ?? game.result}</dd></div>
        <div><dt>Payout</dt><dd>{formatToken(game.payout)} FJT</dd></div>
        <div><dt>Randomness</dt><dd>{game.commitCount}/4 commit · {game.revealCount}/4 reveal</dd></div>
      </dl>

      {deadline > 0n && (
        <div className={`deadline ${expired ? "expired" : ""}`}>
          <span>{expired ? "Scadenza superata" : "Tempo rimasto"}</span>
          <strong>{expired ? `+${formatDuration(-remaining)}` : formatDuration(remaining)}</strong>
          <small>{formatTimestamp(deadline)}</small>
        </div>
      )}
    </div>
  );
}
