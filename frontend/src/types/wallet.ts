import type { BrowserProvider, JsonRpcSigner } from "ethers";
import type { Confirmation } from "../utils/async";

export type WalletState = {
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  account: string | null;
  chainId: bigint | null;
};

export type PanelProps = WalletState & {
  refreshNonce: number;
  confirmation?: Confirmation;
  onTransactionConfirmed: (confirmation?: Confirmation) => void;
};
