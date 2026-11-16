import { Contract, MaxUint256, formatUnits, parseUnits } from "ethers";
import { useCallback, useState } from "react";
import { mockTokenAbi } from "../contracts/abis";
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

export default function TokenPanel({
  provider,
  signer,
  account,
  refreshNonce,
  confirmation,
  onTransactionConfirmed,
}: PanelProps) {
  const [amount, setAmount] = useState("100");
  const operation = useOperation();
  const load = useCallback(
    (signal: AbortSignal, confirmed?: Confirmation, minimumBlock?: number) =>
      readSnapshot(
        provider!,
        signal,
        confirmed,
        async (blockTag) => {
          const token = new Contract(
            contractConfig.tokenAddress!,
            mockTokenAbi,
            provider!
          );
          const [decimals, balance, allowance, symbol] = await Promise.all([
            token.decimals({ blockTag }),
            token.balanceOf(account, { blockTag }),
            token.allowance(account, contractConfig.poolAddress, { blockTag }),
            token.symbol({ blockTag }),
          ]);
          return {
            decimals: Number(decimals),
            balance: formatUnits(balance, decimals),
            allowance: formatUnits(allowance, decimals),
            symbol: String(symbol),
          };
        },
        minimumBlock
      ),
    [account, provider]
  );
  const resource = useAsyncResource(load, refreshNonce, confirmation);
  const data = resource.data;
  const blocked =
    operation.busy || resource.loading || Boolean(resource.error) || !data;
  function transact(action: "mint" | "approve" | "approveMax") {
    if (!signer || !account || blocked) return;
    void operation.run(async (progress) => {
      const token = new Contract(
        contractConfig.tokenAddress!,
        mockTokenAbi,
        signer
      );
      const value =
        action === "approveMax"
          ? MaxUint256
          : parseUnits(amount, data!.decimals);
      progress("Conferma nel wallet…", "wallet");
      const tx =
        action === "mint"
          ? await token.mint(account, value)
          : await token.approve(contractConfig.poolAddress, value);
      const confirmed = await confirmTransaction(tx, progress);
      progress("Aggiornamento dati…", "syncing");
      const updated = await resource.refresh(confirmed);
      onTransactionConfirmed(confirmed);
      if (updated)
        operation.succeed(
          action === "mint" ? "Token creati." : "Allowance aggiornata."
        );
    });
  }
  return (
    <section aria-busy={operation.busy || resource.loading}>
      <div className="section-heading">
        <div>
          <span className="step">01</span>
          <h2>Test token</h2>
        </div>
        <p>Crea token FJT e autorizza il pool.</p>
      </div>
      <dl className="stats">
        <div>
          <dt>Saldo {data?.symbol ?? "FJT"}</dt>
          <dd>{data?.balance ?? "—"}</dd>
        </div>
        <div>
          <dt>Allowance pool</dt>
          <dd>
            {data?.allowance ?? "—"} {data?.symbol ?? "FJT"}
          </dd>
        </div>
      </dl>
      <label>
        Importo token
        <input
          value={amount}
          disabled={operation.busy}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
        />
      </label>
      <div className="actions">
        <button
          type="button"
          onClick={() => transact("mint")}
          disabled={!signer || blocked}
        >
          Mint
        </button>
        <button
          type="button"
          onClick={() => transact("approve")}
          disabled={!signer || blocked}
        >
          Approve esatto
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => void resource.refresh()}
          disabled={!provider || operation.busy || resource.loading}
        >
          Aggiorna
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => transact("approveMax")}
          disabled={!signer || blocked}
        >
          Allowance massima
        </button>
      </div>
      <AsyncFeedback operation={operation} resource={resource} />
    </section>
  );
}
