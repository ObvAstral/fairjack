import { Contract, formatUnits, parseUnits } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { fairJackPoolAbi, mockTokenAbi } from "../contracts/abis";
import { contractConfig } from "../config/contracts";
import type { PanelProps } from "../types/wallet";
import { readableError } from "../utils/errors";

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
  const [bet, setBet] = useState("25");
  const [decimals, setDecimals] = useState(18);
  const [minimum, setMinimum] = useState(0n);
  const [maximum, setMaximum] = useState(0n);
  const [nextGameId, setNextGameId] = useState(0n);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!provider || !contractConfig.poolAddress || !contractConfig.tokenAddress) return;
    try {
      const pool = new Contract(contractConfig.poolAddress, fairJackPoolAbi, provider);
      const token = new Contract(contractConfig.tokenAddress, mockTokenAbi, provider);
      const [minBet, maxBet, nextId, tokenDecimals] = await Promise.all([
        pool.MIN_BET(), pool.MAX_BET(), pool.nextGameId(), token.decimals(),
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
    const timeout = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh, refreshNonce]);

  async function start() {
    if (!signer || !contractConfig.poolAddress) return;
    try {
      setPending(true);
      setError(null);
      setSuccess(null);
      const pool = new Contract(contractConfig.poolAddress, fairJackPoolAbi, signer);
      const gameId = await pool.nextGameId() as bigint;
      const tx = await pool.startPoolGame(parseUnits(bet, decimals));
      await tx.wait();
      setSuccess(`Partita #${gameId.toString()} creata. Ora tutti e quattro i partecipanti devono inviare il commit.`);
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
      <div className="section-heading"><div><span className="step">04</span><h2>Nuova partita</h2></div><p>Blocca la puntata e seleziona il comitato.</p></div>
      <dl className="stats compact">
        <div><dt>Prossimo ID</dt><dd>#{nextGameId.toString()}</dd></div>
        <div><dt>Puntata consentita</dt><dd>{formatUnits(minimum, decimals)}–{formatUnits(maximum, decimals)} FJT</dd></div>
      </dl>
      <div className="form-grid single-row">
        <label>Puntata FJT
          <input value={bet} onChange={(event) => setBet(event.target.value)} inputMode="decimal" />
        </label>
        <button type="button" onClick={() => void start()} disabled={!signer || pending}>
          {pending ? "Creazione…" : "Crea partita"}
        </button>
      </div>
      <p className="hint">Richiede allowance, liquidità pari a 2× la puntata e tre validator idonei diversi dal player.</p>
      {success && <p className="success">{success}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
