import { BrowserProvider } from "ethers";
import { useCallback, useEffect, useState } from "react";
import ConnectWallet from "./components/ConnectWallet";
import TokenPanel from "./components/TokenPanel";
import PoolPanel from "./components/PoolPanel";
import { contractConfig } from "./config/contracts";
import type { WalletState } from "./types/wallet";
import { readableError } from "./utils/errors";
import "./App.css";

export default function App() {
  const [wallet, setWallet] = useState<WalletState>({ provider: null, signer: null, account: null, chainId: null });
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      setWalletError("MetaMask o un wallet EIP-1193 non è disponibile.");
      return;
    }
    try {
      setConnecting(true);
      setWalletError(null);
      await window.ethereum.request({ method: "eth_requestAccounts" });
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const network = await provider.getNetwork();
      setWallet({ provider, signer, account: await signer.getAddress(), chainId: network.chainId });
    } catch (cause) {
      setWalletError(readableError(cause));
    } finally {
      setConnecting(false);
    }
  }, []);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;
    const handleChange = () => { void connect(); };
    ethereum.on("accountsChanged", handleChange);
    ethereum.on("chainChanged", handleChange);
    return () => {
      ethereum.removeListener("accountsChanged", handleChange);
      ethereum.removeListener("chainChanged", handleChange);
    };
  }, [connect]);

  const panelProps = {
    ...wallet,
    refreshNonce,
    onTransactionConfirmed: () => setRefreshNonce((value) => value + 1),
  };

  return (
    <main className="app">
      <h1>FairJack</h1>
      <p className="subtitle">Interfaccia tecnica temporanea — Giorno 2</p>

      {contractConfig.errors.length > 0 && (
        <aside className="config-warning">
          <strong>Configurazione incompleta</strong>
          <span>{contractConfig.errors.join(" · ")}</span>
        </aside>
      )}

      <ConnectWallet
        account={wallet.account}
        chainId={wallet.chainId}
        connecting={connecting}
        error={walletError}
        onConnect={() => void connect()}
        onClear={() => setWallet({ provider: null, signer: null, account: null, chainId: null })}
      />
      <TokenPanel {...panelProps} />
      <PoolPanel {...panelProps} />
    </main>
  );
}
