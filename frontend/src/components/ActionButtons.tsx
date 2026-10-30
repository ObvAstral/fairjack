type ActionButtonsProps = {
  isPlayer: boolean;
  state: number;
  queued: boolean;
  pending: string | null;
  expired: boolean;
  localToolsEnabled: boolean;
  onAction: (
    action:
      "hit" | "stand" | "timeout" | "process" | "request" | "fulfill" | "time",
  ) => void;
  onRefresh: () => void;
};
export default function ActionButtons({
  isPlayer,
  state,
  queued,
  pending,
  expired,
  localToolsEnabled,
  onAction,
  onRefresh,
}: ActionButtonsProps) {
  const busy = pending !== null;
  return (
    <div className="action-panel">
      <div className="actions">
        {isPlayer && state === 3 && (
          <>
            <button
              type="button"
              onClick={() => onAction("hit")}
              disabled={busy || expired}
            >
              {pending === "hit" ? "Hit…" : "Hit"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => onAction("stand")}
              disabled={busy || expired}
            >
              {pending === "stand" ? "Stand…" : "Stand"}
            </button>
          </>
        )}
        {state === 2 && (
          <button
            type="button"
            onClick={() => onAction("process")}
            disabled={busy}
          >
            {pending === "process" ? "Elaborazione…" : "Elabora carte"}
          </button>
        )}
        {state === 1 && queued && (
          <button
            type="button"
            onClick={() => onAction("request")}
            disabled={busy}
          >
            {pending === "request" ? "Invio…" : "Invia richiesta in attesa"}
          </button>
        )}
        {state === 1 && !queued && localToolsEnabled && (
          <button
            type="button"
            className="secondary"
            onClick={() => onAction("fulfill")}
            disabled={busy}
          >
            {pending === "fulfill"
              ? "Simulazione…"
              : "Simula risposta (locale)"}
          </button>
        )}
        {state === 3 && expired && (
          <button
            type="button"
            className="danger"
            onClick={() => onAction("timeout")}
            disabled={busy}
          >
            {pending === "timeout" ? "Claim…" : "Claim timeout"}
          </button>
        )}
        {state === 3 && localToolsEnabled && (
          <button
            type="button"
            className="secondary"
            onClick={() => onAction("time")}
            disabled={busy}
          >
            Supera deadline (locale)
          </button>
        )}
        <button
          type="button"
          className="secondary"
          onClick={onRefresh}
          disabled={busy}
        >
          Aggiorna partita
        </button>
      </div>
    </div>
  );
}
