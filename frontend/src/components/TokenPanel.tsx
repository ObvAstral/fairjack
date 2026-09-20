import { Contract, MaxUint256, formatUnits, parseUnits } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { mockTokenAbi } from "../contracts/abis";
import { contractConfig } from "../config/contracts";
import type { PanelProps } from "../types/wallet";
import { readableError } from "../utils/errors";

export default function TokenPanel({
  provider,
  signer,
  account,
  refreshNonce,
  onTransactionConfirmed,
}: PanelProps) {
  const [balance, setBalance] = useState("—");
  const [allowance, setAllowance] = useState("—");
  const [symbol, setSymbol] = useState("FJT");
  const [decimals, setDecimals] = useState(18);
  const [amount, setAmount] = useState("100");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!provider || !account || !contractConfig.tokenAddress) return;
    try {
      const token = new Contract(contractConfig.tokenAddress, mockTokenAbi, provider);
      const tokenDecimals = Number(await token.decimals());
      const [rawBalance, rawAllowance, tokenSymbol] = await Promise.all([
        token.balanceOf(account),
        contractConfig.poolAddress ? token.allowance(account, contractConfig.poolAddress) : 0n,
        token.symbol(),
      ]);
      setDecimals(tokenDecimals);
      setBalance(formatUnits(rawBalance, tokenDecimals));
      setAllowance(formatUnits(rawAllowance, tokenDecimals));
      setSymbol(tokenSymbol);
      setError(null);
    } catch (cause) {
      setError(readableError(cause));
    }
  }, [account, provider]);

  useEffect(() => {
    const timeout = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh, refreshNonce]);

  async function transact(action: "mint" | "approve" | "approveMax") {
    if (!signer || !account || !contractConfig.tokenAddress) return;
    if (action !== "mint" && !contractConfig.poolAddress) return;
    try {
      setPending(action);
      setError(null);
      setSuccess(null);
      const token = new Contract(contractConfig.tokenAddress, mockTokenAbi, signer);
      const value = parseUnits(amount, decimals);
      const tx = action === "mint"
        ? await token.mint(account, value)
        : await token.approve(contractConfig.poolAddress, action === "approveMax" ? MaxUint256 : value);
      await tx.wait();
      await refresh();
      onTransactionConfirmed();
      setSuccess(action === "mint" ? "Token creati." : "Allowance aggiornata.");
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setPending(null);
    }
  }

  return (
    <section>
      <div className="section-heading"><div><span className="step">01</span><h2>Test token</h2></div><p>Crea token FJT e autorizza il pool.</p></div>
      <dl className="stats">
        <div><dt>Saldo {symbol}</dt><dd>{balance}</dd></div>
        <div><dt>Allowance pool</dt><dd>{allowance} {symbol}</dd></div>
      </dl>
      <label>Importo token
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
      </label>
      <div className="actions">
        <button type="button" onClick={() => void transact("mint")} disabled={!signer || !!pending}>
          {pending === "mint" ? "Mint in corso…" : "Mint"}
        </button>
        <button type="button" onClick={() => void transact("approve")} disabled={!signer || !contractConfig.poolAddress || !!pending}>
          {pending === "approve" ? "Approve in corso…" : "Approve esatto"}
        </button>
        <button type="button" className="secondary" onClick={() => void refresh()} disabled={!provider}>Aggiorna</button>
        <button type="button" className="secondary" onClick={() => void transact("approveMax")} disabled={!signer || !contractConfig.poolAddress || !!pending}>
          {pending === "approveMax" ? "Approve…" : "Allowance massima"}
        </button>
      </div>
      {success && <p className="success">{success}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
