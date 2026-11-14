import { Contract } from "ethers";
import { randomBytes } from "node:crypto";
import { mockVrfWrapperAbi } from "../../frontend/src/contracts/abis.js";
import { RelayEngine } from "./engine.js";

/** Follows committed choices. Never chooses Hit/Stand or replaces VRF requests. */
export class Dealer {
  private running = false;
  private retries = new Map<string, { after: number; attempts: number }>();
  private timer?: ReturnType<typeof setInterval>;
  constructor(readonly engine: RelayEngine, readonly autoFulfill = false, readonly retryDelayMs = 30_000) {
    if (autoFulfill && engine.chainId !== 31337n) throw new Error("Il dealer può simulare VRF solo su Hardhat Local.");
  }
  start(intervalMs = this.engine.chainId === 31337n ? 1000 : 5000) {
    this.timer = setInterval(() => { void this.tick(); }, intervalMs);
    void this.tick();
  }
  stop() { if (this.timer) clearInterval(this.timer); }
  async tick() {
    if (this.running || this.engine.halted) return;
    this.running = true;
    try {
      await this.engine.checkChain();
      await this.engine.drain();
      for (const id of this.engine.store.games()) {
        if ((this.retries.get(id)?.after ?? 0) > Date.now()) continue;
        try {
          const core = await this.engine.pool.getGameCore(id);
          if (Number(core.state) === 5) { this.engine.store.finish(id); this.retries.delete(id); continue; }
          const randomness = await this.engine.pool.getGameRandomness(id);
          let data: string;
          let method: string;
          let target = this.engine.poolAddress;
          if (Number(core.state) === 2) {
            method = "processRandomness";
            data = this.engine.pool.interface.encodeFunctionData(method, [id]);
          } else if (Number(core.state) === 3) {
            const deadline = await this.engine.pool.getActionDeadline(id);
            const block = await this.engine.provider.send("eth_getBlockByNumber", ["pending", false]) as { timestamp: string } | null;
            if (!block || BigInt(block.timestamp) <= deadline) continue;
            method = "claimTimeout";
            data = this.engine.pool.interface.encodeFunctionData(method, [id]);
          } else if (Number(core.state) === 1 && randomness.queued) {
            method = "requestPendingRandomness";
            // A deferred oracle request may wait for an outage to end. Read-only
            // simulation avoids repeatedly paying for known reverts.
            data = this.engine.pool.interface.encodeFunctionData(method, [id]);
          } else if (Number(core.state) === 1 && this.autoFulfill && !randomness.fulfilled) {
            target = await this.engine.pool.vrfWrapper();
            const oracle = new Contract(target, mockVrfWrapperAbi, this.engine.provider);
            method = "fulfillRandomWords";
            data = oracle.interface.encodeFunctionData(method, [randomness.requestId, BigInt(`0x${randomBytes(32).toString("hex")}`)]);
          } else continue;
          await this.engine.enqueueDealer(data, `dealer:${id}:${method}:${randomness.requestId}`, target);
          this.retries.delete(id);
        } catch (error) {
          const attempts = (this.retries.get(id)?.attempts ?? 0) + 1;
          this.retries.set(id, { attempts, after: Date.now() + Math.min(300_000, this.retryDelayMs * 2 ** Math.min(attempts - 1, 4)) });
          console.error(`Dealer partita ${id}:`, error instanceof Error ? error.message : "operazione non disponibile");
        }
      }
    } catch (error) {
      console.error("Dealer:", error instanceof Error ? error.message : "chain non disponibile");
    } finally { this.running = false; }
  }
}
