import { Contract, formatUnits, parseUnits } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { fairJackPoolAbi, mockTokenAbi } from "../contracts/abis";
import { contractConfig } from "../config/contracts";
import type { PanelProps } from "../types/wallet";
import { readableError } from "../utils/errors";

type PoolData = {
  balance: string;
  locked: string;
  available: string;
  shares: string;
  sharePrice: string;
  totalShares: string;
};

const emptyData: PoolData = { balance: "—", locked: "—", available: "—", shares: "—", sharePrice: "—", totalShares: "—" };

export default function PoolPanel({
  provider,
  signer,
  account,
  refreshNonce,
  onTransactionConfirmed,
}: PanelProps) {
  const [data, setData] = useState<PoolData>(emptyData);
  const [decimals, setDecimals] = useState(18);
  const [depositAmount, setDepositAmount] = useState("10");
  const [withdrawShares, setWithdrawShares] = useState("10");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!provider || !account || !contractConfig.poolAddress || !contractConfig.tokenAddress) return;
    try {
      const pool = new Contract(contractConfig.poolAddress, fairJackPoolAbi, provider);
      const token = new Contract(contractConfig.tokenAddress, mockTokenAbi, provider);
      const tokenDecimals = Number(await token.decimals());
      const [balance, locked, available, shares, sharePrice, totalShares] = await Promise.all([
        pool.poolBalance(), pool.lockedLiquidity(), pool.getAvailableLiquidity(),
        pool.sharesOf(account), pool.getSharePrice(), pool.totalShares(),
      ]);
      setDecimals(tokenDecimals);
      setData({
        balance: formatUnits(balance, tokenDecimals),
        locked: formatUnits(locked, tokenDecimals),
        available: formatUnits(available, tokenDecimals),
        shares: formatUnits(shares, tokenDecimals),
        sharePrice: formatUnits(sharePrice, 18),
        totalShares: formatUnits(totalShares, tokenDecimals),
      });
      setError(null);
    } catch (cause) {
      setError(readableError(cause));
    }
  }, [account, provider]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh, refreshNonce]);

  async function transact(action: "deposit" | "withdraw") {
    if (!signer || !contractConfig.poolAddress) return;
    try {
      setPending(action);
      setError(null);
      setSuccess(null);
      const pool = new Contract(contractConfig.poolAddress, fairJackPoolAbi, signer);
      const value = parseUnits(action === "deposit" ? depositAmount : withdrawShares, decimals);
      const tx = action === "deposit"
        ? await pool.depositToHousePool(value)
        : await pool.withdrawFromHousePool(value);
      await tx.wait();
      await refresh();
      onTransactionConfirmed();
      setSuccess(action === "deposit" ? "Deposito confermato." : "Prelievo confermato.");
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setPending(null);
    }
  }

  return (
    <section>
      <div className="section-heading"><div><span className="step">02</span><h2>House pool</h2></div><p>Fornisci o ritira liquidità dal banco.</p></div>
      <dl className="stats">
        <div><dt>Pool balance</dt><dd>{data.balance}</dd></div>
        <div><dt>Liquidità bloccata</dt><dd>{data.locked}</dd></div>
        <div><dt>Liquidità disponibile</dt><dd>{data.available}</dd></div>
        <div><dt>Shares personali</dt><dd>{data.shares}</dd></div>
        <div><dt>Shares totali</dt><dd>{data.totalShares}</dd></div>
        <div><dt>Prezzo share</dt><dd>{data.sharePrice}</dd></div>
      </dl>
      <div className="form-grid">
        <label>Token da depositare
          <input value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} inputMode="decimal" />
        </label>
        <button type="button" onClick={() => void transact("deposit")} disabled={!signer || !!pending}>
          {pending === "deposit" ? "Deposito…" : "Deposita"}
        </button>
        <label>Shares da ritirare
          <input value={withdrawShares} onChange={(event) => setWithdrawShares(event.target.value)} inputMode="decimal" />
        </label>
        <button type="button" onClick={() => void transact("withdraw")} disabled={!signer || !!pending}>
          {pending === "withdraw" ? "Prelievo…" : "Ritira"}
        </button>
      </div>
      <button type="button" className="secondary" onClick={() => void refresh()} disabled={!provider}>Aggiorna dati pool</button>
      {success && <p className="success">{success}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
