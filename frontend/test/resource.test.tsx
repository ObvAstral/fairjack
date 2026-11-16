import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAsyncResource } from "../src/utils/useAsyncResource";
import { useOperation } from "../src/utils/useOperation";
import type { Confirmation, Snapshot } from "../src/utils/async";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
const tick = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
afterEach(() => vi.useRealTimers());
describe("resource lifecycle", () => {
  it("hides the previous selection and discards late replies, including after unmount", async () => {
    vi.useFakeTimers();
    const first = deferred<Snapshot<string>>(),
      second = deferred<Snapshot<string>>();
    const a = vi.fn(() => first.promise),
      b = vi.fn(() => second.promise);
    const { result, rerender, unmount } = renderHook(
      ({ load }) => useAsyncResource(load, 0),
      { initialProps: { load: a } }
    );
    await tick();
    rerender({ load: b });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    await tick();
    await act(async () => {
      first.resolve({ data: "old", blockNumber: 1 });
    });
    expect(result.current.data).toBeNull();
    await act(async () => {
      second.resolve({ data: "new", blockNumber: 2 });
    });
    expect(result.current.data).toBe("new");
    unmount();
    await act(async () => {
      first.resolve({ data: "old", blockNumber: 1 });
    });
  });
  it("keeps loaded data visible and serializes silent background polling", async () => {
    vi.useFakeTimers();
    const delayed = deferred<Snapshot<string>>();
    const load = vi
      .fn()
      .mockResolvedValueOnce({ data: "cards", blockNumber: 1 })
      .mockReturnValue(delayed.promise);
    const { result } = renderHook(() =>
      useAsyncResource(load, 0, undefined, 4000)
    );
    await tick();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.current.data).toBe("cards");
    expect(result.current.loading).toBe(false);
    await act(async () => {
      delayed.resolve({ data: "new cards", blockNumber: 2 });
    });
    expect(result.current.data).toBe("new cards");
  });
  it("does not repeat failed synchronization when the parent broadcasts the same confirmation", async () => {
    vi.useFakeTimers();
    const load = vi
      .fn()
      .mockResolvedValueOnce({ data: "old", blockNumber: 1 })
      .mockRejectedValue(new Error("dati non ancora aggiornati"));
    const confirmed: Confirmation = { txHash: "confirmed", blockNumber: 2 };
    const { result, rerender } = renderHook(
      ({
        nonce,
        confirmation,
      }: {
        nonce: number;
        confirmation?: Confirmation;
      }) => useAsyncResource(load, nonce, confirmation),
      { initialProps: { nonce: 0 } }
    );
    await tick();
    await act(async () => {
      await result.current.refresh(confirmed);
    });
    rerender({ nonce: 1, confirmation: confirmed });
    await tick();
    expect(result.current.error).toContain("dati non ancora aggiornati");
    expect(result.current.data).toBe("old");
    expect(result.current.loading).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => {
      await result.current.refresh();
    });
    expect(load).toHaveBeenCalledTimes(3);
  });
  it("blocks duplicate operations and releases the controls after rejection", async () => {
    const wait = deferred<void>();
    const action = vi.fn(() => wait.promise);
    const { result } = renderHook(useOperation);
    let first!: Promise<void>;
    act(() => {
      first = result.current.run(action);
      void result.current.run(action);
    });
    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await act(async () => {
      wait.resolve();
      await first;
    });
    await act(async () => {
      await result.current.run(async () => {
        throw new Error("Operazione rifiutata nel wallet.");
      });
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toContain("rifiutata");
  });
});
