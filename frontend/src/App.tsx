import { BrowserProvider } from "ethers";
import { useCallback, useEffect, useState } from "react";
import ConnectWallet from "./components/ConnectWallet";
import GameBoard from "./components/GameBoard";
import PoolPanel from "./components/PoolPanel";
import StartGame from "./components/StartGame";
import TokenPanel from "./components/TokenPanel";
import ValidatorPanel from "./components/ValidatorPanel";
import { contractConfig } from "./config/contracts";
import type { WalletState } from "./types/wallet";
import { readableError } from "./utils/errors";
import "./App.css";

export default function App() {
  const [wallet, setWallet] = useState<WalletState>({ provider: null, signer: null, account: null, chainId: null });
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [selectedGameId, setSelectedGameId] = useState(0n);

  const syncWallet = useCallback(async (requestAccess: boolean) => {
    if (!window.ethereum) {
      setWalletError("MetaMask o un wallet EIP-1193 non è disponibile.");
      return;
    }
    try {
      setConnecting(true);
      setWalletError(null);
      const accounts = await window.ethereum.request({ method: requestAccess ? "eth_requestAccounts" : "eth_accounts" }) as string[];
      if (accounts.length === 0) {
        setWallet({ provider: null, signer: null, account: null, chainId: null });
        return;
      }
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner(accounts[0]);
      const network = await provider.getNetwork();
      setWallet({ provider, signer, account: await signer.getAddress(), chainId: network.chainId });
    } catch (cause) {
      setWalletError(readableError(cause));
    } finally {
      setConnecting(false);
    }
  }, []);

  const connect = useCallback(async () => syncWallet(true), [syncWallet]);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum) return;
    const chainId = `0x${contractConfig.expectedChainId.toString(16)}`;
    try {
      setWalletError(null);
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (cause) {
      const code = typeof cause === "object" && cause !== null && "code" in cause
        ? Number((cause as { code: unknown }).code)
        : null;
      if (code !== 4902) {
        setWalletError(readableError(cause));
        return;
      }
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId,
            chainName: "Hardhat Local",
            nativeCurrency: { name: "Local ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: [contractConfig.rpcUrl],
          }],
        });
      } catch (addCause) {
        setWalletError(readableError(addCause));
      }
    }
  }, []);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;
    const timeout = window.setTimeout(() => { void syncWallet(false); }, 0);
    const handleChange = () => { void syncWallet(false); };
    ethereum.on("accountsChanged", handleChange);
    ethereum.on("chainChanged", handleChange);
    return () => {
      window.clearTimeout(timeout);
      ethereum.removeListener("accountsChanged", handleChange);
      ethereum.removeListener("chainChanged", handleChange);
    };
  }, [syncWallet]);

  useEffect(() => {
    if (!wallet.provider || !contractConfig.tokenAddress || !contractConfig.poolAddress || wallet.chainId !== contractConfig.expectedChainId) {
      const timeout = window.setTimeout(() => setDeploymentError(null), 0);
      return () => window.clearTimeout(timeout);
    }
    let active = true;
    void Promise.all([
      wallet.provider.getCode(contractConfig.tokenAddress),
      wallet.provider.getCode(contractConfig.poolAddress),
    ]).then(([tokenCode, poolCode]) => {
      if (!active) return;
      setDeploymentError(tokenCode === "0x" || poolCode === "0x"
        ? "Gli indirizzi configurati non contengono contratti su questa chain. Riavvia il deploy locale e il frontend."
        : null);
    }).catch((cause: unknown) => {
      if (active) setDeploymentError(readableError(cause));
    });
    return () => { active = false; };
  }, [wallet.chainId, wallet.provider]);

  const panelProps = {
    ...wallet,
    refreshNonce,
    onTransactionConfirmed: () => setRefreshNonce((value) => value + 1),
  };

  const correctNetwork = wallet.chainId === contractConfig.expectedChainId;
  const appReady = Boolean(wallet.account && correctNetwork && contractConfig.errors.length === 0 && !deploymentError);

  return (
    <main className="app">
      <header className="hero">
        <div>
          <span className="brand-mark">FJ</span>
          <div><h1>FairJack</h1><p>Blackjack decentralizzato · console locale</p></div>
        </div>
        <span className="build-label">TESTNET UI</span>
      </header>

      {contractConfig.errors.length > 0 && (
        <aside className="config-warning">
          <strong>Configurazione incompleta</strong>
          <span>{contractConfig.errors.join(" · ")}</span>
        </aside>
      )}

      {deploymentError && <aside className="config-warning"><strong>Deploy non trovato</strong><span>{deploymentError}</span></aside>}

      <ConnectWallet
        account={wallet.account}
        chainId={wallet.chainId}
        connecting={connecting}
        error={walletError}
        expectedChainId={contractConfig.expectedChainId}
        onConnect={() => void connect()}
        onClear={() => setWallet({ provider: null, signer: null, account: null, chainId: null })}
        onSwitchNetwork={() => void switchNetwork()}
      />

      {!wallet.account && <div className="empty-state"><strong>Connetti il wallet per iniziare.</strong><span>Usa gli account del nodo Hardhat locale per simulare player, staker e validator.</span></div>}
      {wallet.account && !correctNetwork && <div className="empty-state"><strong>Rete non corretta.</strong><span>Passa alla chain {contractConfig.expectedChainId.toString()} per usare i contratti configurati.</span></div>}

      {appReady && (
        <>
          <div className="dashboard-grid">
            <TokenPanel {...panelProps} />
            <PoolPanel {...panelProps} />
            <ValidatorPanel {...panelProps} />
            <StartGame
              {...panelProps}
              onGameStarted={(gameId) => {
                setSelectedGameId(gameId);
                window.setTimeout(() => document.querySelector(".game-section")?.scrollIntoView({ behavior: "smooth" }), 100);
              }}
            />
          </div>
          <GameBoard
            {...panelProps}
            selectedGameId={selectedGameId}
            onSelectGame={setSelectedGameId}
          />
          <details className="test-guide">
            <summary>Checklist rapida per il collaudo</summary>
            <ol>
              <li>Mint e allowance su almeno quattro account; deposita liquidità con uno di essi.</li>
              <li>Registra tre account come validator con almeno 100 FJT ciascuno.</li>
              <li>Da un quarto account crea la partita e invia il commit del player.</li>
              <li>Passa ai tre validator selezionati: genera il segreto e invia ogni commit.</li>
              <li>Esegui i quattro reveal, poi usa Hit o Stand dal player.</li>
              <li>Per slashing e penalità, crea nuove partite, ometti un’azione e usa “Supera deadline”.</li>
            </ol>
          </details>
        </>
      )}
    </main>
  );
}
