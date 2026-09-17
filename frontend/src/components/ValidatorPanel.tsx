import { Contract, formatUnits, parseUnits } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { fairJackPoolAbi, mockTokenAbi } from "../contracts/abis";
import { contractConfig } from "../config/contracts";
import type { PanelProps } from "../types/wallet";
import { readableError } from "../utils/errors";

type ValidatorData = {
  registered: boolean;
  collateral: bigint;
  activeGames: bigint;
  slashCount: bigint;
  validatorCount: bigint;
  minimum: bigint;
  perGame: bigint;
};

const emptyData: ValidatorData = {
  registered: false,
  collateral: 0n,
  activeGames: 0n,
  slashCount: 0n,
  validatorCount: 0n,
  minimum: 0n,
  perGame: 0n,
};

export default function ValidatorPanel({
  provider,
  signer,
  account,
  refreshNonce,
  onTransactionConfirmed,
}: PanelProps) {
  const [data, setData] = useState<ValidatorData>(emptyData);
  const [decimals, setDecimals] = useState(18);
  const [amount, setAmount] = useState("200");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!provider || !account || !contractConfig.poolAddress || !contractConfig.tokenAddress) return;
    try {
      const pool = new Contract(contractConfig.poolAddress, fairJackPoolAbi, provider);
      const token = new Contract(contractConfig.tokenAddress, mockTokenAbi, provider);
      const [info, validatorCount, minimum, perGame, tokenDecimals] = await Promise.all([
        pool.validators(account),
        pool.getValidatorCount(),
        pool.MIN_VALIDATOR_COLLATERAL(),
        pool.VALIDATOR_COLLATERAL_PER_GAME(),
        token.decimals(),
      ]);
      setDecimals(Number(tokenDecimals));
      setData({
        registered: info.registered,
        collateral: info.collateral,
        activeGames: info.activeGames,
        slashCount: info.slashCount,
        validatorCount,
        minimum,
        perGame,
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

  async function transact(action: "register" | "add" | "withdraw" | "unregister") {
    if (!signer || !contractConfig.poolAddress) return;
    try {
      setPending(action);
      setError(null);
      setSuccess(null);
      const pool = new Contract(contractConfig.poolAddress, fairJackPoolAbi, signer);
      const value = parseUnits(amount, decimals);
      const tx = action === "register"
        ? await pool.registerAsValidator(value)
        : action === "add"
          ? await pool.addValidatorCollateral(value)
          : action === "withdraw"
            ? await pool.withdrawValidatorCollateral(value)
            : await pool.unregisterAsValidator();
      await tx.wait();
      await refresh();
      onTransactionConfirmed();
      setSuccess("Operazione validator confermata.");
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setPending(null);
    }
  }

  const required = data.activeGames * data.perGame > data.minimum
    ? data.activeGames * data.perGame
    : data.minimum;
  const withdrawable = data.collateral > required ? data.collateral - required : 0n;

  return (
    <section>
      <div className="section-heading"><div><span className="step">03</span><h2>Validator</h2></div><p>Gestisci registrazione, collateral e capacità.</p></div>
      <dl className="stats">
        <div><dt>Stato account</dt><dd><span className={`status-dot ${data.registered ? "ok" : ""}`} />{data.registered ? "Registrato" : "Non registrato"}</dd></div>
        <div><dt>Validator registrati</dt><dd>{data.validatorCount.toString()}</dd></div>
        <div><dt>Collateral</dt><dd>{formatUnits(data.collateral, decimals)} FJT</dd></div>
        <div><dt>Collateral libero</dt><dd>{formatUnits(withdrawable, decimals)} FJT</dd></div>
        <div><dt>Partite attive</dt><dd>{data.activeGames.toString()}</dd></div>
        <div><dt>Slash ricevuti</dt><dd>{data.slashCount.toString()}</dd></div>
      </dl>
      <p className="hint">Minimo {formatUnits(data.minimum, decimals)} FJT · riserva {formatUnits(data.perGame, decimals)} FJT per partita.</p>
      <label>Importo collateral
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
      </label>
      <div className="actions">
        {!data.registered ? (
          <button type="button" onClick={() => void transact("register")} disabled={!signer || !!pending}>
            {pending === "register" ? "Registrazione…" : "Registrati"}
          </button>
        ) : (
          <>
            <button type="button" onClick={() => void transact("add")} disabled={!signer || !!pending}>Aggiungi collateral</button>
            <button type="button" className="secondary" onClick={() => void transact("withdraw")} disabled={!signer || !!pending}>Ritira collateral</button>
            <button type="button" className="danger" onClick={() => void transact("unregister")} disabled={!signer || !!pending || data.activeGames > 0n}>Disiscriviti</button>
          </>
        )}
        <button type="button" className="secondary" onClick={() => void refresh()} disabled={!provider}>Aggiorna</button>
      </div>
      {success && <p className="success">{success}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
