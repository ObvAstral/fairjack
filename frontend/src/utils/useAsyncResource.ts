import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Confirmation, Snapshot } from "./async";
import { readableError } from "./errors";

type Loader<T> = (
  signal: AbortSignal,
  confirmation?: Confirmation,
  minimumBlock?: number
) => Promise<Snapshot<T>>;
export function useAsyncResource<T>(
  load: Loader<T>,
  refreshNonce: number,
  confirmation?: Confirmation,
  pollMs = 0
) {
  const request = useMemo(
    () => ({ load, refreshNonce, confirmation }),
    [load, refreshNonce, confirmation]
  );
  const [state, setState] = useState<{
    request: typeof request | null;
    load: Loader<T> | null;
    data: T | null;
    loading: boolean;
    error: string | null;
    confirmed: boolean;
  }>({
    request: null,
    load: null,
    data: null,
    loading: true,
    error: null,
    confirmed: false,
  });
  const runner = useRef<
    ((confirmation?: Confirmation) => Promise<boolean>) | null
  >(null);
  const acknowledgement = useRef<{ load: Loader<T>; hash: string } | null>(
    null
  );
  const lastBlock = useRef<{ load: Loader<T>; number: number } | null>(null);
  useEffect(() => {
    let active = true,
      version = 0,
      inFlight = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let currentConfirmation = confirmation;
    async function run(
      foreground: boolean,
      override?: Confirmation
    ): Promise<boolean> {
      if (!active || (!foreground && inFlight)) return false;
      const attempt = ++version;
      inFlight = true;
      clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      if (override) currentConfirmation = override;
      if (foreground)
        setState((previous) => ({
          ...previous,
          request,
          loading: true,
          error: null,
        }));
      try {
        const minimum =
          lastBlock.current?.load === load ? lastBlock.current.number : 0;
        const result = await load(
          controller.signal,
          currentConfirmation,
          minimum
        );
        if (!active || attempt !== version) return false;
        lastBlock.current = { load, number: result.blockNumber };
        if (override) acknowledgement.current = { load, hash: override.txHash };
        setState({
          request,
          load,
          data: result.data,
          loading: false,
          error: null,
          confirmed: Boolean(currentConfirmation),
        });
        return true;
      } catch (cause) {
        if (active && attempt === version) {
          if (override)
            acknowledgement.current = { load, hash: override.txHash };
          setState((previous) => ({
            ...previous,
            request,
            load,
            data: previous.load === load ? previous.data : null,
            loading: false,
            error: readableError(cause),
            confirmed: Boolean(currentConfirmation),
          }));
        }
        return false;
      } finally {
        if (active && attempt === version) {
          inFlight = false;
          if (pollMs)
            timer = setTimeout(() => {
              void run(false);
            }, pollMs);
        }
      }
    }
    const refresh = (override?: Confirmation) => run(true, override);
    runner.current = refresh;
    timer = setTimeout(() => {
      // The parent broadcasts a transaction that this panel has already read.
      // Acknowledge it without repeating a failed 30-second synchronization.
      if (
        acknowledgement.current?.load === load &&
        acknowledgement.current.hash === confirmation?.txHash
      ) {
        acknowledgement.current = null;
        setState((previous) => ({ ...previous, request, loading: false }));
        if (pollMs)
          timer = setTimeout(() => {
            void run(false);
          }, pollMs);
      } else void run(true);
    }, 0);
    return () => {
      active = false;
      ++version;
      clearTimeout(timer);
      controller?.abort();
      if (runner.current === refresh) runner.current = null;
    };
  }, [request, load, confirmation, pollMs]);
  const refresh = useCallback(
    (override?: Confirmation) =>
      runner.current?.(override) ?? Promise.resolve(false),
    []
  );
  const sameLoad = state.load === load;
  const current = state.request === request;
  return {
    data: sameLoad ? state.data : null,
    loading: !current || state.loading,
    error: current ? state.error : null,
    confirmed: current && state.confirmed,
    refresh,
  };
}
