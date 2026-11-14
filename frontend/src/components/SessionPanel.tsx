import { useState } from "react";
import { formatEther } from "ethers";
import { useGameSession } from "../utils/useGameSession";

export default function SessionPanel() {
  const session = useGameSession();
  const [budget, setBudget] = useState("100");
  const [maxBet, setMaxBet] = useState("25");
  return <section className="session-panel">
    <div className="section-heading"><div><h2>Sessione di gioco</h2></div><p>Autorizza una sessione, poi gioca senza popup.</p></div>
    <dl className="stats">
      <div><dt>Stato</dt><dd>{session.active ? "Attiva" : "Da autorizzare"}</dd></div>
      <div><dt>Budget residuo</dt><dd>{formatEther(session.remaining)} FJT</dd></div>
      <div><dt>Puntata massima</dt><dd>{formatEther(session.maxBet)} FJT</dd></div>
      <div><dt>Tempo residuo</dt><dd>{Math.ceil(session.secondsLeft / 60)} min</dd></div>
    </dl>
    <div className="form-grid">
      <label>Budget totale FJT<input value={budget} onChange={(event) => setBudget(event.target.value)} inputMode="decimal" /></label>
      <label>Puntata massima FJT<input value={maxBet} onChange={(event) => setMaxBet(event.target.value)} inputMode="decimal" /></label>
    </div>
    <div className="actions">
      <button onClick={() => void session.open(budget, maxBet)} disabled={session.busy || session.pending || !session.available}>{session.busy ? "Operazione in corso…" : session.active ? "Rinnova sessione" : "Apri sessione (30 min)"}</button>
      <button className="secondary" onClick={() => void session.revoke()} disabled={session.revoking}>{session.revoking ? "Revoca…" : "Revoca dal wallet"}</button>
      {session.pending && <button className="secondary" disabled={session.busy} onClick={() => void session.resume()}>Verifica operazione</button>}
    </div>
    <p className="hint">L’eventuale approve iniziale e la revoca richiedono il wallet e il tuo gas. Durante la sessione paga l’applicazione. Dopo un refresh serve una nuova firma; puoi riprendere le partite già iniziate.</p>
    {!session.available && <p className="error">{session.unavailable || "Collegamento al relayer…"} Puoi scegliere la modalità wallet per inviare direttamente le transazioni.</p>}
    <label className="wallet-mode"><input type="checkbox" checked={session.walletMode} onChange={(event) => session.setWalletMode(event.target.checked)} disabled={session.busy || session.pending} /> Modalità wallet: conferma e gas a mio carico per ogni azione</label>
    {session.status && <p className="success" role="status">{session.status}</p>}
    {session.error && <p className="error" role="alert">{session.error}</p>}
  </section>;
}
