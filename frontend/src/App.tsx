import { BrowserProvider, Contract } from "ethers";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ConnectWallet from "./components/ConnectWallet";
import GameBoard from "./components/GameBoard";
import PoolPanel from "./components/PoolPanel";
import StartGame from "./components/StartGame";
import TokenPanel from "./components/TokenPanel";
import OraclePanel from "./components/OraclePanel";
import { fairJackPoolAbi } from "./contracts/abis";
import { contractConfig } from "./config/contracts";
import type { WalletState } from "./types/wallet";
import { readableError } from "./utils/errors";
import { createWalletSigner } from "./utils/walletSigner";
import SessionPanel from "./components/SessionPanel";
import LoadingStatus from "./components/LoadingStatus";
import { readSnapshot, type Confirmation } from "./utils/async";
import "./App.css";

const GameSessionProvider = lazy(
  () => import("./components/GameSessionProvider")
);

export default function App() {
  const [wallet, setWallet] = useState<WalletState>({
    provider: null,
    signer: null,
    account: null,
    chainId: null,
  });
  const activeProvider = useRef<BrowserProvider | null>(null);
  useEffect(() => {
    activeProvider.current = wallet.provider;
    return () => {
      activeProvider.current = null;
    };
  }, [wallet.provider]);
  const walletLock = useRef(false),
    switchLock = useRef(false),
    walletVersion = useRef(0);
  const [switching, setSwitching] = useState(false);
  const [validatedProvider, setValidatedProvider] =
    useState<BrowserProvider | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | undefined>();
  const [selection, setSelection] = useState({ revision: 0, explicit: false });
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
    if (requestAccess && walletLock.current) return;
    if (requestAccess) walletLock.current = true;
    const version = ++walletVersion.current;
    try {
      setConnecting(true);
      setWalletError(null);
      const accounts = (await window.ethereum.request({
        method: requestAccess ? "eth_requestAccounts" : "eth_accounts",
      })) as string[];
      if (version !== walletVersion.current) return;
      if (accounts.length === 0) {
        setWallet({
          provider: null,
          signer: null,
          account: null,
          chainId: null,
        });
        return;
      }
      const provider = new BrowserProvider(window.ethereum);
      const signer = await createWalletSigner(provider, accounts[0]);
      const network = await provider.getNetwork();
      if (version !== walletVersion.current) return;
      setConfirmation(undefined);
      setWallet({
        provider,
        signer,
        account: await signer.getAddress(),
        chainId: network.chainId,
      });
    } catch (cause) {
      if (version === walletVersion.current)
        setWalletError(readableError(cause));
    } finally {
      if (requestAccess) walletLock.current = false;
      if (version === walletVersion.current) setConnecting(false);
    }
  }, []);

  const connect = useCallback(async () => syncWallet(true), [syncWallet]);

  const switchNetwork = useCallback(async () => {
    if (!window.ethereum || switchLock.current) return;
    switchLock.current = true;
    setSwitching(true);
    const chainId = `0x${contractConfig.expectedChainId.toString(16)}`;
    try {
      try {
        setWalletError(null);
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId }],
        });
      } catch (cause) {
        const code =
          typeof cause === "object" && cause !== null && "code" in cause
            ? Number((cause as { code: unknown }).code)
            : null;
        if (code !== 4902) {
          setWalletError(readableError(cause));
          return;
        }
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId,
                chainName: contractConfig.networkName,
                nativeCurrency: {
                  name: contractConfig.nativeCurrencyName,
                  symbol: contractConfig.nativeCurrencySymbol,
                  decimals: 18,
                },
                rpcUrls: [contractConfig.rpcUrl],
                ...(contractConfig.blockExplorerUrl
                  ? { blockExplorerUrls: [contractConfig.blockExplorerUrl] }
                  : {}),
              },
            ],
          });
        } catch (addCause) {
          setWalletError(readableError(addCause));
          return;
        }
      }
      await syncWallet(false);
    } finally {
      switchLock.current = false;
      setSwitching(false);
    }
  }, [syncWallet]);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;
    const timeout = window.setTimeout(() => {
      void syncWallet(false);
    }, 0);
    const handleChange = () => {
      void syncWallet(false);
    };
    ethereum.on("accountsChanged", handleChange);
    ethereum.on("chainChanged", handleChange);
    return () => {
      window.clearTimeout(timeout);
      ethereum.removeListener("accountsChanged", handleChange);
      ethereum.removeListener("chainChanged", handleChange);
    };
  }, [syncWallet]);

  useEffect(() => {
    if (
      !wallet.provider ||
      !contractConfig.tokenAddress ||
      !contractConfig.poolAddress ||
      wallet.chainId !== contractConfig.expectedChainId
    ) {
      const timeout = window.setTimeout(() => setDeploymentError(null), 0);
      return () => window.clearTimeout(timeout);
    }
    let active = true;
    const controller = new AbortController();
    void readSnapshot(
      wallet.provider,
      controller.signal,
      undefined,
      (blockTag) =>
        Promise.all([
          wallet.provider!.getCode(contractConfig.tokenAddress!, blockTag),
          wallet.provider!.getCode(contractConfig.poolAddress!, blockTag),
          new Contract(
            contractConfig.poolAddress!,
            fairJackPoolAbi,
            wallet.provider!
          ).vrfWrapper({ blockTag }),
        ])
    )
      .then(({ data: [tokenCode, poolCode] }) => {
        if (!active) return;
        setValidatedProvider(wallet.provider);
        setDeploymentError(
          tokenCode === "0x" || poolCode === "0x"
            ? "Gli indirizzi configurati non contengono contratti su questa chain. Verifica il deploy e la configurazione del frontend."
            : null
        );
      })
      .catch((cause: unknown) => {
        if (active) {
          setValidatedProvider(wallet.provider);
          setDeploymentError(
            `Il contratto configurato non risponde come FairJack VRF. Verifica il nuovo deploy e gli indirizzi. ${readableError(
              cause
            )}`
          );
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [wallet.chainId, wallet.provider]);

  const onConfirmed = useCallback(
    (confirmed?: Confirmation) => {
      if (activeProvider.current !== wallet.provider) return;
      if (confirmed)
        setConfirmation((previous) =>
          previous?.blockNumber &&
          confirmed.blockNumber &&
          previous.blockNumber > confirmed.blockNumber
            ? previous
            : confirmed
        );
      setRefreshNonce((value) => value + 1);
    },
    [wallet.provider]
  );
  const selectGame = (gameId: bigint) => {
    setSelectedGameId(gameId);
    setSelection((previous) => ({
      revision: previous.revision + 1,
      explicit: true,
    }));
  };
  const panelProps = {
    ...wallet,
    refreshNonce,
    confirmation,
    onTransactionConfirmed: onConfirmed,
  };

  const correctNetwork = wallet.chainId === contractConfig.expectedChainId;
  const localNetwork = contractConfig.expectedChainId === 31337n;
  const appReady = Boolean(
    wallet.account &&
      correctNetwork &&
      contractConfig.errors.length === 0 &&
      validatedProvider === wallet.provider &&
      !connecting &&
      !switching &&
      !deploymentError
  );

  return (
    <main className="app">
      <header className="hero">
        <div>
          <span className="brand-mark">FJ</span>
          <div>
            <h1>FairJack</h1>
            <p>Blackjack decentralizzato · {contractConfig.networkName}</p>
          </div>
        </div>
        <span className="build-label">TESTNET UI</span>
      </header>

      {contractConfig.errors.length > 0 && (
        <aside className="config-warning">
          <strong>Configurazione incompleta</strong>
          <span>{contractConfig.errors.join(" · ")}</span>
        </aside>
      )}

      {deploymentError && validatedProvider === wallet.provider && (
        <aside className="config-warning">
          <strong>Deploy non trovato</strong>
          <span>{deploymentError}</span>
        </aside>
      )}

      <ConnectWallet
        account={wallet.account}
        chainId={wallet.chainId}
        connecting={connecting}
        switching={switching}
        error={walletError}
        expectedChainId={contractConfig.expectedChainId}
        networkName={contractConfig.networkName}
        onConnect={() => void connect()}
        onClear={() => {
          ++walletVersion.current;
          setConnecting(false);
          setWallet({
            provider: null,
            signer: null,
            account: null,
            chainId: null,
          });
        }}
        onSwitchNetwork={() => void switchNetwork()}
      />

      {wallet.account &&
        correctNetwork &&
        validatedProvider !== wallet.provider &&
        !connecting && <LoadingStatus>Verifica dei contratti…</LoadingStatus>}

      {!wallet.account && !connecting && (
        <div className="empty-state">
          <strong>Connetti il wallet per iniziare.</strong>
          <span>
            Gli account che inviano transazioni devono avere ETH sulla rete{" "}
            {contractConfig.networkName}.
          </span>
        </div>
      )}
      {wallet.account && !correctNetwork && (
        <div className="empty-state">
          <strong>Rete non corretta.</strong>
          <span>
            Passa a {contractConfig.networkName} (chain{" "}
            {contractConfig.expectedChainId.toString()}) per usare i contratti
            configurati.
          </span>
        </div>
      )}

      {appReady && (
        <Suspense
          fallback={<LoadingStatus>Caricamento delle sessioni…</LoadingStatus>}
        >
          <GameSessionProvider
            key={`${wallet.chainId}:${wallet.account}`}
            wallet={wallet}
            onConfirmed={panelProps.onTransactionConfirmed}
          >
            <SessionPanel />
            <div className="dashboard-grid">
              <TokenPanel {...panelProps} />
              <PoolPanel {...panelProps} />
              <OraclePanel {...panelProps} />
              <StartGame
                {...panelProps}
                onGameStarted={(gameId) => {
                  if (activeProvider.current !== wallet.provider) return;
                  selectGame(gameId);
                  window.setTimeout(
                    () =>
                      document
                        .querySelector(".game-section")
                        ?.scrollIntoView({ behavior: "smooth" }),
                    100
                  );
                }}
              />
            </div>
            <GameBoard
              {...panelProps}
              selectedGameId={selectedGameId}
              selectionRevision={selection.revision}
              selectionExplicit={selection.explicit}
              onSelectGame={selectGame}
            />
            <details className="test-guide">
              <summary>Checklist rapida per il collaudo</summary>
              <ol>
                <li>
                  Mint e allowance per player e staker; deposita FJT nella house
                  pool.
                </li>
                <li>
                  Finanzia la riserva ETH dell’oracolo: è un contributo separato
                  dalle share.
                </li>
                <li>
                  Apri una sessione e crea una partita. La pool paga VRF, il
                  relayer paga il gas delle mosse.
                </li>
                <li>
                  {localNetwork
                    ? "Il dealer simula la risposta locale ed elabora le carte automaticamente."
                    : "Attendi Chainlink VRF: il dealer elabora automaticamente le carte."}
                </li>
                <li>
                  Ogni Hit richiede una nuova risposta. Stand richiede
                  randomness solo se il dealer deve pescare.
                </li>
                <li>
                  Per il timeout del player,{" "}
                  {localNetwork
                    ? "usa “Supera deadline” durante il suo turno."
                    : "attendi la scadenza durante il suo turno."}{" "}
                  L’attesa dell’oracolo non penalizza il player.
                </li>
              </ol>
            </details>
          </GameSessionProvider>
        </Suspense>
      )}
    </main>
  );
}
