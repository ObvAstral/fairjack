import { Contract, Transaction, isError, keccak256, toUtf8Bytes } from "ethers";
import type { BaseWallet, JsonRpcApiProvider, TransactionReceipt } from "ethers";
import { randomUUID } from "node:crypto";
import { fairJackPoolAbi } from "../../frontend/src/contracts/abis.js";
import { readableError } from "../../frontend/src/utils/errors.js";
import { Store } from "./store.js";
import type { Job } from "./store.js";

export type Limits = { gasPerTx: bigint; feePerGas: bigint; dailyBudget: bigint; maxSessionBudget: bigint };

export class RelayEngine {
  readonly pool: Contract;
  private draining = false;
  halted: string | null = null;
  constructor(
    readonly provider: JsonRpcApiProvider, readonly wallet: BaseWallet,
    readonly chainId: bigint, readonly poolAddress: string, readonly deploymentId: string,
    readonly store: Store, readonly limits: Limits,
  ) { this.pool = new Contract(poolAddress, fairJackPoolAbi, provider); }

  async checkChain() {
    if (this.halted) throw new Error(this.halted);
    if (BigInt(await this.provider.send("eth_chainId", [])) !== this.chainId ||
      await this.pool.sessionDeploymentId() !== this.deploymentId)
      this.halted = "La chain o il deploy è cambiato: riavvia il relayer dopo il nuovo deploy.";
    const saved = this.store.metadata("checkpoint");
    if (saved) {
      const checkpoint = JSON.parse(saved) as { number: number; hash: string };
      const block = await this.provider.getBlock(checkpoint.number);
      if (!block || block.hash !== checkpoint.hash)
        this.halted = "Chain ripristinata o riorganizzata: riavvia il servizio con un nuovo deploy e ricarica il sito.";
    }
    if (this.halted) throw new Error(this.halted);
  }

  async preflight(data: string, target = this.poolAddress) {
    await this.checkChain();
    if (target.toLowerCase() !== this.poolAddress.toLowerCase() &&
      !(this.chainId === 31337n && target.toLowerCase() === (await this.pool.vrfWrapper() as string).toLowerCase()))
      throw new Error("Destinazione non consentita.");
    const fees = await this.provider.getFeeData();
    const maxFeePerGas = fees.maxFeePerGas ?? fees.gasPrice;
    if (!maxFeePerGas || maxFeePerGas > this.limits.feePerGas) throw new Error("Sponsorizzazione sospesa: prezzo del gas oltre il limite.");
    let estimate: bigint;
    try { estimate = await this.provider.estimateGas({ from: this.wallet.address, to: target, data }); }
    catch (error) {
      if (isError(error, "CALL_EXCEPTION") && error.data) {
        const parsed = this.pool.interface.parseError(error.data);
        if (parsed) throw new Error(parsed.name);
      }
      throw error;
    }
    const gasLimit = (estimate * 120n + 99n) / 100n;
    if (gasLimit > this.limits.gasPerTx) throw new Error("Operazione oltre il limite di gas.");
    const cost = gasLimit * maxFeePerGas;
    if (this.store.committedCost() + cost > this.limits.dailyBudget) throw new Error("Budget giornaliero del relayer esaurito.");
    if (await this.provider.getBalance(this.wallet.address) < cost) throw new Error("Saldo ETH del relayer insufficiente.");
    return { gasLimit, maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n, cost };
  }

  async enqueue(data: string, payload: string, slot: string, id?: string, target = this.poolAddress): Promise<Job> {
    id ??= keccak256(toUtf8Bytes(`${this.store.scope}:${payload}`));
    const existing = this.store.get(id);
    if (existing) return existing;
    if (this.store.active(slot)) throw new Error("Un’operazione con questo nonce è già in corso.");
    try { await this.preflight(data, target); }
    catch (error) {
      const raced = this.store.get(id);
      if (raced) return raced;
      throw error;
    }
    // Recheck after async validation: two HTTP requests may have interleaved.
    const raced = this.store.get(id);
    if (raced) return raced;
    if (this.store.active(slot)) throw new Error("Un’operazione con questo nonce è già in corso.");
    const row = this.store.insert(id, slot, payload, data, target);
    void this.drain();
    return row;
  }

  async enqueueDealer(data: string, slot: string, target = this.poolAddress) {
    if (!this.store.active(slot)) await this.enqueue(data, JSON.stringify({ dealer: slot }), slot, randomUUID(), target);
  }

  async drain() {
    if (this.draining || this.halted) return;
    this.draining = true;
    try {
      await this.checkChain();
      for (const row of this.store.pending()) {
        if (row.status === "queued") {
          try {
            const fees = await this.preflight(row.data, row.target);
            const nonce = Number(BigInt(await this.provider.send("eth_getTransactionCount", [this.wallet.address, "pending"])));
            const raw = await this.wallet.signTransaction({
              to: row.target, data: row.data, chainId: this.chainId, nonce,
              type: 2, gasLimit: fees.gasLimit, maxFeePerGas: fees.maxFeePerGas,
              maxPriorityFeePerGas: fees.maxPriorityFeePerGas > fees.maxFeePerGas ? fees.maxFeePerGas : fees.maxPriorityFeePerGas,
            });
            // Persist BEFORE broadcasting. A lost RPC response can only cause
            // a rebroadcast of the identical transaction, never a second bet.
            this.store.update(row.id, { raw, txHash: Transaction.from(raw).hash!, nonce, cost: fees.cost.toString(), status: "submitted" });
          } catch (error) {
            this.store.update(row.id, { status: "failed", error: readableError(error) });
            continue;
          }
        }
        const submitted = this.store.get(row.id)!;
        if (!await this.reconcile(submitted)) break;
      }
    } catch (error) {
      // Keep pending jobs for the next dealer tick / process restart.
      console.error("Relayer:", readableError(error));
    } finally { this.draining = false; }
  }

  private async reconcile(row: Job): Promise<boolean> {
    let receipt = await this.provider.getTransactionReceipt(row.txHash!);
    if (!receipt) {
      try { await this.provider.broadcastTransaction(row.raw!); }
      catch { /* Reconcile an already known transaction before deciding its fate. */ }
      receipt = await this.provider.getTransactionReceipt(row.txHash!);
    }
    if (!receipt) {
      const used = BigInt(await this.provider.send("eth_getTransactionCount", [this.wallet.address, "latest"]));
      if (used > BigInt(row.nonce!)) {
        this.halted = "Nonce del relayer consumato da una transazione esterna: verifica l’account prima di ripartire.";
      }
      return false;
    }
    this.confirm(row, receipt);
    return true;
  }

  private confirm(row: Job, receipt: TransactionReceipt) {
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const changes: Partial<Job> = { status: receipt.status === 1 ? "confirmed" : "failed", cost: receipt.fee.toString() };
      if (receipt.status !== 1) changes.error = "Transazione fallita sulla chain; aggiorna lo stato prima di riprovare.";
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== this.poolAddress.toLowerCase()) continue;
        const event = this.pool.interface.parseLog(log);
        if (event?.name === "SessionRegistered") changes.sessionId = event.args.sessionId;
        if (event?.name === "PoolGameStarted") {
          changes.gameId = event.args.gameId.toString();
          this.store.track(changes.gameId!);
        }
      }
      this.store.update(row.id, changes);
      this.store.setMetadata("checkpoint", JSON.stringify({ number: receipt.blockNumber, hash: receipt.blockHash }));
      this.store.db.exec("COMMIT");
    } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
  }
}
