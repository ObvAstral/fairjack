import { Contract, formatEther, parseEther } from "ethers";
import { useCallback, useState } from "react";
import { contractConfig } from "../config/contracts";
import { fairJackPoolAbi } from "../contracts/abis";
import type { PanelProps } from "../types/wallet";
import {
  confirmTransaction,
  readSnapshot,
  type Confirmation,
} from "../utils/async";
import { useAsyncResource } from "../utils/useAsyncResource";
import { useOperation } from "../utils/useOperation";
import AsyncFeedback from "./AsyncFeedback";

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
  confirmation,
  onTransactionConfirmed,
}: PanelProps) {
  const [amount, setAmount] = useState("0.1");
  const operation = useOperation();
  const load = useCallback(
    (signal: AbortSignal, confirmed?: Confirmation, minimumBlock?: number) =>
      readSnapshot(
        provider!,
        signal,
        confirmed,
        async (blockTag): Promise<ReserveData> => {
          const pool = new Contract(
            contractConfig.poolAddress!,
            fairJackPoolAbi,
            provider!
          );
          const [reserve, locked, available, spent, required, cap, feeData] =
            await Promise.all([
              pool.getOracleReserve({ blockTag }),
              pool.lockedOracleBudget({ blockTag }),
              pool.getAvailableOracleReserve({ blockTag }),
              pool.totalOracleSpent({ blockTag }),
              pool.getRequiredOracleBudget({ blockTag }),
              pool.maxOracleRequestCost({ blockTag }),
              provider!.getFeeData(),
            ]);
          const quote = (await pool
            .quoteOracleRequest({ blockTag, gasPrice: feeData.gasPrice ?? 0n })
            .catch(() => null)) as bigint | null;
          return { reserve, locked, available, spent, required, cap, quote };
        },
        minimumBlock
      ),
    [provider]
  );
  const resource = useAsyncResource(load, refreshNonce, confirmation, 6000);
  const data = resource.data;
  function fund() {
    if (
      !signer ||
      operation.busy ||
      resource.loading ||
      Boolean(resource.error) ||
      !data
    )
      return;
    void operation.run(async (progress) => {
      const pool = new Contract(
        contractConfig.poolAddress!,
        fairJackPoolAbi,
        signer
      );
      const value = parseEther(amount);
      progress("Conferma nel wallet…", "wallet");
      const confirmed = await confirmTransaction(
        await pool.fundOracle({ value }),
        progress
      );
      progress("Aggiornamento dati…", "syncing");
      const updated = await resource.refresh(confirmed);
      onTransactionConfirmed(confirmed);
      if (updated)
        operation.succeed(
          "Riserva finanziata. Gli ETH sono destinati al servizio e non generano share."
        );
    });
  }
  const value = (key: keyof ReserveData) => {
    const amount = data?.[key];
    return amount == null ? "—" : `${formatEther(amount)} ETH`;
  };
  return (
    <section aria-busy={operation.busy || resource.loading}>
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
            disabled={operation.busy}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <button
          type="button"
          onClick={() => void fund()}
          disabled={
            !signer ||
            operation.busy ||
            resource.loading ||
            Boolean(resource.error) ||
            !data
          }
        >
          Finanzia riserva
        </button>
      </div>
      <p className="hint">
        Contributo irrevocabile: non genera share e non è prelevabile. Può
        contribuire qualunque account; i player non devono finanziare ogni
        richiesta.
      </p>
      <AsyncFeedback operation={operation} resource={resource} />
      {data?.quote === null && (
        <p className="hint">
          Preventivo dell’oracolo temporaneamente non disponibile.
        </p>
      )}
    </section>
  );
}
