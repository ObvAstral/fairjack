import type {
  BrowserProvider,
  TransactionReceipt,
  TransactionResponse,
} from "ethers";

export type Confirmation = { txHash: string; blockNumber?: number };
export type OperationPhase = "wallet" | "submitting" | "confirming" | "syncing";
export type Progress = (message: string, phase: OperationPhase) => void;
export type Snapshot<T> = { data: T; blockNumber: number };

export class SynchronizationError extends Error {
  constructor() {
    super(
      "Operazione confermata, dati non ancora aggiornati. Riprova l’aggiornamento."
    );
  }
}

export async function confirmTransaction(
  tx: TransactionResponse,
  progress: Progress,
  onReceipt?: (receipt: TransactionReceipt) => void
): Promise<Confirmation> {
  progress("Attesa conferma sulla rete…", "confirming");
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1)
    throw new Error("Transazione non confermata.");
  onReceipt?.(receipt);
  return { txHash: receipt.hash, blockNumber: receipt.blockNumber };
}

// Read a single explicit block, never a mixture of pre- and post-transaction state.
export async function readSnapshot<T>(
  provider: BrowserProvider,
  signal: AbortSignal,
  confirmation: Confirmation | undefined,
  read: (blockNumber: number) => Promise<T>,
  minimumBlock = 0
): Promise<Snapshot<T>> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(
    () =>
      controller.abort(
        confirmation
          ? new SynchronizationError()
          : new Error("Lettura dei dati scaduta. Riprova l’aggiornamento.")
      ),
    30_000
  );
  const bounded = <R>(promise: Promise<R>): Promise<R> =>
    new Promise((resolve, reject) => {
      const stop = () => reject(controller.signal.reason);
      if (controller.signal.aborted) {
        stop();
        return;
      }
      controller.signal.addEventListener("abort", stop, { once: true });
      promise
        .then(resolve, reject)
        .finally(() => controller.signal.removeEventListener("abort", stop));
    });
  const pause = () =>
    bounded(
      new Promise<void>((resolve) => {
        const timer = setTimeout(done, 1000);
        function done() {
          controller.signal.removeEventListener("abort", cancel);
          resolve();
        }
        function cancel() {
          clearTimeout(timer);
        }
        controller.signal.addEventListener("abort", cancel, { once: true });
      })
    );
  try {
    let required = Math.max(minimumBlock, confirmation?.blockNumber ?? 0);
    if (confirmation && confirmation.blockNumber === undefined) {
      let receipt = await bounded(
        provider.getTransactionReceipt(confirmation.txHash)
      );
      while (!receipt) {
        await pause();
        receipt = await bounded(
          provider.getTransactionReceipt(confirmation.txHash)
        );
      }
      required = Math.max(required, receipt.blockNumber);
    }
    let blockNumber = Number(
      BigInt(await bounded(provider.send("eth_blockNumber", [])))
    );
    while (blockNumber < required) {
      await pause();
      blockNumber = Number(
        BigInt(await bounded(provider.send("eth_blockNumber", [])))
      );
    }
    return { data: await bounded(read(blockNumber)), blockNumber };
  } catch (cause) {
    if (confirmation && !signal.aborted) throw new SynchronizationError();
    throw cause;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    controller.abort();
  }
}
