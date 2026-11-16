import LoadingStatus from "./LoadingStatus";
type ConnectWalletProps = {
  account: string | null;
  chainId: bigint | null;
  connecting: boolean;
  switching: boolean;
  error: string | null;
  expectedChainId: bigint;
  networkName: string;
  onConnect: () => void;
  onClear: () => void;
  onSwitchNetwork: () => void;
};

export default function ConnectWallet({
  account,
  chainId,
  connecting,
  switching,
  error,
  expectedChainId,
  networkName,
  onConnect,
  onClear,
  onSwitchNetwork,
}: ConnectWalletProps) {
  const wrongNetwork = chainId !== null && chainId !== expectedChainId;

  return (
    <section className="wallet-bar" aria-busy={connecting || switching}>
      <div>
        <span className="eyebrow">Wallet</span>
        <h2>
          {account
            ? `${account.slice(0, 6)}…${account.slice(-4)}`
            : "Non connesso"}
        </h2>
      </div>
      {account ? (
        <div className="wallet-actions">
          <span className={`network-pill ${wrongNetwork ? "wrong" : ""}`}>
            <i />{" "}
            {wrongNetwork ? `Chain ${chainId?.toString() ?? "—"}` : networkName}
          </span>
          {wrongNetwork && (
            <button
              type="button"
              onClick={onSwitchNetwork}
              disabled={connecting || switching}
            >
              Passa a {networkName}
            </button>
          )}
          <button
            type="button"
            className="secondary"
            onClick={onClear}
            disabled={switching}
          >
            Scollega dalla UI
          </button>
        </div>
      ) : (
        <button type="button" onClick={onConnect} disabled={connecting}>
          {connecting ? "Connessione…" : "Connetti MetaMask"}
        </button>
      )}
      {(connecting || switching) && (
        <div className="full-row">
          <LoadingStatus>
            {switching
              ? "Conferma il cambio rete nel wallet…"
              : "Connessione al wallet…"}
          </LoadingStatus>
        </div>
      )}
      {error && <p className="error full-row">{error}</p>}
    </section>
  );
}
