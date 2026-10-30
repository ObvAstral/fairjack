import { Contract, formatEther, parseEther } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { contractConfig } from "../config/contracts";
import { fairJackPoolAbi } from "../contracts/abis";
import type { PanelProps } from "../types/wallet";
import { readableError } from "../utils/errors";

type ReserveData = {
  reserve: bigint;
  locked: bigint;
  available: bigint;
  spent: bigint;
  required: bigint;
  quote: bigint | null;
  cap: bigint;
};
export default function OraclePanel({
  provider,
  signer,
  refreshNonce,
  onTransactionConfirmed,
}: PanelProps) {
  const [data, setData] = useState<ReserveData | null>(null);
  const [amount, setAmount] = useState("0.1");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!provider || !contractConfig.poolAddress) return;
    try {
      const pool = new Contract(
        contractConfig.poolAddress,
        fairJackPoolAbi,
        provider,
      );
      const [reserve, locked, available, spent, required, cap] =
        await Promise.all([
          pool.getOracleReserve(),
          pool.lockedOracleBudget(),
          pool.getAvailableOracleReserve(),
          pool.totalOracleSpent(),
          pool.getRequiredOracleBudget(),
          pool.maxOracleRequestCost(),
        ]);
      const feeData = await provider.getFeeData();
      const quote = (await pool
        .quoteOracleRequest({ gasPrice: feeData.gasPrice ?? 0n })
        .catch(() => null)) as bigint | null;
      setData({
        reserve,
        locked,
        available,
        spent,
        required,
        cap,
        quote,
      });
      setError(
        quote === null
          ? "Preventivo dell’oracolo temporaneamente non disponibile."
          : null,
      );
    } catch (cause) {
      setError(readableError(cause));
    }
  }, [provider]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh();
    }, 0);
    const poll = window.setInterval(() => {
      void refresh();
    }, 6000);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(poll);
    };
  }, [refresh, refreshNonce]);
  async function fund() {
    if (!signer || !contractConfig.poolAddress) return;
    try {
      setPending(true);
      setError(null);
      setSuccess(null);
      const pool = new Contract(
        contractConfig.poolAddress,
        fairJackPoolAbi,
        signer,
      );
      const tx = await pool.fundOracle({ value: parseEther(amount) });
      await tx.wait();
      onTransactionConfirmed();
      await refresh();
      setSuccess(
        "Riserva finanziata. Gli ETH sono destinati al servizio e non generano share.",
      );
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setPending(false);
    }
  }
  const value = (key: keyof ReserveData) => {
    const amount = data?.[key];
    return amount == null ? "—" : `${formatEther(amount)} ETH`;
  };
  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="step">03</span>
          <h2>Riserva oracolo</h2>
        </div>
        <p>La pool sostiene il costo delle carte casuali.</p>
      </div>
      <dl className="stats">
        <div>
          <dt>Saldo ETH</dt>
          <dd>{value("reserve")}</dd>
        </div>
        <div>
          <dt>Riservati alle partite</dt>
          <dd>{value("locked")}</dd>
        </div>
        <div>
          <dt>Disponibili</dt>
          <dd>{value("available")}</dd>
        </div>
        <div>
          <dt>Spesa totale</dt>
          <dd>{value("spent")}</dd>
        </div>
        <div>
          <dt>Budget per nuova partita</dt>
          <dd>{value("required")}</dd>
        </div>
        <div>
          <dt>Preventivo indicativo</dt>
          <dd>{value("quote")}</dd>
        </div>
        <div>
          <dt>Massimo per richiesta</dt>
          <dd>{value("cap")}</dd>
        </div>
      </dl>
      {data && data.available < data.required && (
        <p className="hint">
          Riserva libera insufficiente per avviare un’altra partita.
        </p>
      )}
      <div className="form-grid single-row">
        <label>
          ETH da destinare al servizio
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <button
          type="button"
          onClick={() => void fund()}
          disabled={!signer || pending}
        >
          {pending ? "Finanziamento…" : "Finanzia riserva"}
        </button>
      </div>
      <p className="hint">
        Contributo irrevocabile: non genera share e non è prelevabile. Può
        contribuire qualunque account; i player non devono finanziare ogni
        richiesta.
      </p>
      {success && <p className="success">{success}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
