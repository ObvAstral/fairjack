import { JsonRpcSigner, getNumber } from "ethers";
import type { BrowserProvider, TransactionRequest } from "ethers";

const LOCAL_CHAIN_ID = 31337n;

class LocalNonceSigner extends JsonRpcSigner {
  private sendQueue: Promise<void> = Promise.resolve();

  override sendUncheckedTransaction(tx: TransactionRequest): Promise<string> {
    const send = this.sendQueue.then(async () => {
      const chainId = BigInt(await this.provider.send("eth_chainId", []));
      if (chainId !== LOCAL_CHAIN_ID) {
        throw new Error("La rete del wallet è cambiata. Riconnetti il wallet prima di riprovare.");
      }

      // Query the node for every send: a restarted Hardhat chain can have a
      // lower nonce than the wallet remembers. Raw RPC bypasses ethers' cache.
      const nonce = getNumber(await this.provider.send("eth_getTransactionCount", [
        this.address,
        "pending",
      ]));
      return super.sendUncheckedTransaction({ ...tx, chainId, nonce });
    });

    // All panels share this signer. Serialize broadcasts, and release the
    // queue after errors/rejections without reserving or incrementing a nonce.
    this.sendQueue = send.then(() => undefined, () => undefined);
    return send;
  }
}

export async function createWalletSigner(
  provider: BrowserProvider,
  account: string,
): Promise<JsonRpcSigner> {
  const signer = await provider.getSigner(account);
  const { chainId } = await provider.getNetwork();
  return chainId === LOCAL_CHAIN_ID
    ? new LocalNonceSigner(provider, signer.address)
    : signer;
}
