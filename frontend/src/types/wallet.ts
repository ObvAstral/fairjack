import type { BrowserProvider, JsonRpcSigner } from "ethers";

export type WalletState = {
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  account: string | null;
  chainId: bigint | null;
};

export type PanelProps = WalletState & {
  refreshNonce: number;
  onTransactionConfirmed: () => void;
};
