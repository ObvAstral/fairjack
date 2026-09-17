type ConnectWalletProps = {
  account: string | null;
  chainId: bigint | null;
  connecting: boolean;
  error: string | null;
  expectedChainId: bigint;
  onConnect: () => void;
  onClear: () => void;
  onSwitchNetwork: () => void;
};

export default function ConnectWallet({
  account,
  chainId,
  connecting,
  error,
  expectedChainId,
  onConnect,
  onClear,
  onSwitchNetwork,
}: ConnectWalletProps) {
  const wrongNetwork = chainId !== null && chainId !== expectedChainId;

  return (
    <section className="wallet-bar">
      <div>
        <span className="eyebrow">Wallet</span>
        <h2>{account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Non connesso"}</h2>
      </div>
      {account ? (
        <div className="wallet-actions">
          <span className={`network-pill ${wrongNetwork ? "wrong" : ""}`}>
            <i /> Chain {chainId?.toString() ?? "—"}
          </span>
          {wrongNetwork && (
            <button type="button" onClick={onSwitchNetwork}>Passa a {expectedChainId.toString()}</button>
          )}
          <button type="button" className="secondary" onClick={onClear}>Scollega dalla UI</button>
        </div>
      ) : (
        <button type="button" onClick={onConnect} disabled={connecting}>
          {connecting ? "Connessione…" : "Connetti MetaMask"}
        </button>
      )}
      {error && <p className="error full-row">{error}</p>}
    </section>
  );
}
