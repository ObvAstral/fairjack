import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserProvider } from "ethers";
import { readSnapshot, SynchronizationError } from "../src/utils/async";

function provider(
  send: () => Promise<string>,
  receipt = vi.fn().mockResolvedValue({ blockNumber: 7 })
) {
  return {
    send: vi.fn(send),
    getTransactionReceipt: receipt,
  } as unknown as BrowserProvider;
}
afterEach(() => vi.useRealTimers());
describe("confirmed snapshots", () => {
  it("waits for the relayed receipt and for the UI node to reach its block", async () => {
    vi.useFakeTimers();
    const receipt = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ blockNumber: 7 });
    const rpc = provider(
      vi.fn().mockResolvedValueOnce("0x4").mockResolvedValue("0x7"),
      receipt
    );
    const read = vi.fn().mockResolvedValue("game zero");
    const result = readSnapshot(
      rpc,
      new AbortController().signal,
      { txHash: "tx" },
      read
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ data: "game zero", blockNumber: 7 });
    expect(read).toHaveBeenCalledExactlyOnceWith(7);
  });
  it("bounds a hung read to thirty seconds and identifies a confirmed transaction", async () => {
    vi.useFakeTimers();
    const result = readSnapshot(
      provider(async () => "0x7"),
      new AbortController().signal,
      { txHash: "tx", blockNumber: 7 },
      () => new Promise(() => {})
    );
    const rejection =
      expect(result).rejects.toBeInstanceOf(SynchronizationError);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels a superseded request without waiting for its RPC response", async () => {
    const controller = new AbortController();
    const result = readSnapshot(
      provider(() => new Promise(() => {})),
      controller.signal,
      undefined,
      vi.fn()
    );
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejection;
  });
  it("never reads a block older than the last applied snapshot", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue("current");
    const result = readSnapshot(
      provider(vi.fn().mockResolvedValueOnce("0x3").mockResolvedValue("0x8")),
      new AbortController().signal,
      undefined,
      read,
      8
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({ data: "current", blockNumber: 8 });
  });
});
