import { Contract, formatUnits, parseUnits } from "ethers";
import { useCallback, useState } from "react";
import { fairJackPoolAbi, mockTokenAbi } from "../contracts/abis";
import { contractConfig } from "../config/contracts";
import type { PanelProps } from "../types/wallet";
import {
  confirmTransaction,
  readSnapshot,
  type Confirmation,
} from "../utils/async";
import { useAsyncResource } from "../utils/useAsyncResource";
import { useOperation } from "../utils/useOperation";
import AsyncFeedback from "./AsyncFeedback";

const emptyData = {
  balance: "—",
  locked: "—",
  available: "—",
  shares: "—",
  sharePrice: "—",
  totalShares: "—",
};
export default function PoolPanel({
  provider,
  signer,
  account,
  refreshNonce,
  confirmation,
  onTransactionConfirmed,
}: PanelProps) {
  const [depositAmount, setDepositAmount] = useState("10"),
    [withdrawShares, setWithdrawShares] = useState("10");
  const operation = useOperation();
  const load = useCallback(
    (signal: AbortSignal, confirmed?: Confirmation, minimumBlock?: number) =>
      readSnapshot(
        provider!,
        signal,
        confirmed,
        async (blockTag) => {
          const pool = new Contract(
            contractConfig.poolAddress!,
            fairJackPoolAbi,
            provider!
          );
          const token = new Contract(
            contractConfig.tokenAddress!,
            mockTokenAbi,
            provider!
          );
          const [
            decimals,
            balance,
            locked,
            available,
            shares,
            sharePrice,
            totalShares,
          ] = await Promise.all([
            token.decimals({ blockTag }),
            pool.poolBalance({ blockTag }),
            pool.lockedLiquidity({ blockTag }),
            pool.getAvailableLiquidity({ blockTag }),
            pool.sharesOf(account, { blockTag }),
            pool.getSharePrice({ blockTag }),
            pool.totalShares({ blockTag }),
          ]);
          return {
            decimals: Number(decimals),
            balance: formatUnits(balance, decimals),
            locked: formatUnits(locked, decimals),
            available: formatUnits(available, decimals),
            shares: formatUnits(shares, decimals),
            sharePrice: formatUnits(sharePrice, 18),
            totalShares: formatUnits(totalShares, decimals),
          };
        },
        minimumBlock
      ),
    [account, provider]
  );
  const resource = useAsyncResource(load, refreshNonce, confirmation);
  const data = resource.data ?? emptyData;
  const blocked =
    operation.busy ||
    resource.loading ||
    Boolean(resource.error) ||
    !resource.data;
  function transact(action: "deposit" | "withdraw") {
    if (!signer || blocked) return;
    void operation.run(async (progress) => {
      const pool = new Contract(
        contractConfig.poolAddress!,
        fairJackPoolAbi,
        signer
      );
      const value = parseUnits(
        action === "deposit" ? depositAmount : withdrawShares,
        resource.data!.decimals
      );
      progress("Conferma nel wallet…", "wallet");
      const tx =
        action === "deposit"
          ? await pool.depositToHousePool(value)
          : await pool.withdrawFromHousePool(value);
      const confirmed = await confirmTransaction(tx, progress);
      progress("Aggiornamento dati…", "syncing");
      const updated = await resource.refresh(confirmed);
      onTransactionConfirmed(confirmed);
      if (updated)
        operation.succeed(
          action === "deposit" ? "Deposito confermato." : "Prelievo confermato."
        );
    });
  }
  return (
    <section aria-busy={operation.busy || resource.loading}>
      <div className="section-heading">
        <div>
          <span className="step">02</span>
          <h2>House pool</h2>
        </div>
        <p>Fornisci o ritira liquidità FJT dal banco.</p>
      </div>
      <dl className="stats">
        <div>
          <dt>Pool balance</dt>
          <dd>{data.balance}</dd>
        </div>
        <div>
          <dt>Liquidità bloccata</dt>
          <dd>{data.locked}</dd>
        </div>
        <div>
          <dt>Liquidità disponibile</dt>
          <dd>{data.available}</dd>
        </div>
        <div>
          <dt>Shares personali</dt>
          <dd>{data.shares}</dd>
        </div>
        <div>
          <dt>Shares totali</dt>
          <dd>{data.totalShares}</dd>
        </div>
        <div>
          <dt>Prezzo share</dt>
          <dd>{data.sharePrice}</dd>
        </div>
      </dl>
      <div className="form-grid">
        <label>
          Token da depositare
          <input
            value={depositAmount}
            disabled={operation.busy}
            onChange={(event) => setDepositAmount(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <button
          type="button"
          onClick={() => void transact("deposit")}
          disabled={!signer || blocked}
        >
          Deposita
        </button>
        <label>
          Shares da ritirare
          <input
            value={withdrawShares}
            disabled={operation.busy}
            onChange={(event) => setWithdrawShares(event.target.value)}
            inputMode="decimal"
          />
        </label>
        <button
          type="button"
          onClick={() => void transact("withdraw")}
          disabled={!signer || blocked}
        >
          Ritira
        </button>
      </div>
      <p className="hint">
        Depositi e prelievi FJT sono sospesi durante le partite attive per
        proteggere il valore delle share. Le share rappresentano i FJT della
        house pool. La riserva ETH del servizio è separata e non è riscattabile.
      </p>
      <button
        type="button"
        className="secondary"
        onClick={() => void resource.refresh()}
        disabled={!provider || operation.busy || resource.loading}
      >
        Aggiorna dati pool
      </button>
      <AsyncFeedback operation={operation} resource={resource} />
    </section>
  );
}
