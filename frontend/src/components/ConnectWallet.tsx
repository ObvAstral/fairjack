type ConnectWalletProps = {
  account: string | null;
  chainId: bigint | null;
  connecting: boolean;
  error: string | null;
  onConnect: () => void;
  onClear: () => void;
};

export default function ConnectWallet({
  account,
  chainId,
  connecting,
  error,
  onConnect,
  onClear,
}: ConnectWalletProps) {
  return (
    <section>
      <h2>Wallet</h2>
      {account ? (
        <>
          <dl className="stats">
            <div><dt>Account</dt><dd><code>{account}</code></dd></div>
            <div><dt>Chain ID</dt><dd>{chainId?.toString() ?? "—"}</dd></div>
          </dl>
          <button type="button" className="secondary" onClick={onClear}>Nascondi account</button>
        </>
      ) : (
        <button type="button" onClick={onConnect} disabled={connecting}>
          {connecting ? "Connessione…" : "Connetti MetaMask"}
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
