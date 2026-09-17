type ActionButtonsProps = {
  role: "player" | "validator" | "observer";
  state: number;
  committed: boolean;
  revealed: boolean;
  secretValid: boolean;
  pending: string | null;
  localToolsEnabled: boolean;
  hasDeadline: boolean;
  onCommit: () => void;
  onReveal: () => void;
  onHit: () => void;
  onStand: () => void;
  onClaimTimeout: () => void;
  onAdvanceTime: () => void;
  onRefresh: () => void;
};

export default function ActionButtons({
  role,
  state,
  committed,
  revealed,
  secretValid,
  pending,
  localToolsEnabled,
  hasDeadline,
  onCommit,
  onReveal,
  onHit,
  onStand,
  onClaimTimeout,
  onAdvanceTime,
  onRefresh,
}: ActionButtonsProps) {
  const busy = pending !== null;

  return (
    <div className="action-panel">
      <div className="actions">
        {role !== "observer" && state === 1 && !committed && (
          <button type="button" onClick={onCommit} disabled={busy || !secretValid}>
            {pending === "commit" ? "Commit…" : "Invia commit"}
          </button>
        )}
        {role !== "observer" && state === 2 && committed && !revealed && (
          <button type="button" onClick={onReveal} disabled={busy || !secretValid}>
            {pending === "reveal" ? "Reveal…" : "Rivela segreto"}
          </button>
        )}
        {role === "player" && state === 3 && (
          <>
            <button type="button" onClick={onHit} disabled={busy}>{pending === "hit" ? "Hit…" : "Hit"}</button>
            <button type="button" className="secondary" onClick={onStand} disabled={busy}>{pending === "stand" ? "Stand…" : "Stand"}</button>
          </>
        )}
        {[1, 2, 3].includes(state) && (
          <button type="button" className="danger" onClick={onClaimTimeout} disabled={busy}>
            {pending === "timeout" ? "Claim…" : "Claim timeout"}
          </button>
        )}
        {localToolsEnabled && hasDeadline && (
          <button type="button" className="secondary" onClick={onAdvanceTime} disabled={busy}>
            {pending === "time" ? "Avanzamento…" : "Supera deadline (locale)"}
          </button>
        )}
        <button type="button" className="secondary" onClick={onRefresh} disabled={busy}>Aggiorna partita</button>
      </div>
    </div>
  );
}
