export type ChainClock = {
  blockHash: string | null;
  timestamp: number;
  loadedAt: number;
};

export function syncChainClock(
  clock: ChainClock | null,
  block: { hash: string | null; timestamp: number },
  now: number,
): ChainClock {
  // Hardhat can return the same block for minutes when no transactions arrive.
  // Keep its original time anchor so polling does not restart the countdown.
  if (
    clock &&
    clock.blockHash === block.hash &&
    clock.timestamp === block.timestamp
  ) {
    return clock;
  }
  return { blockHash: block.hash, timestamp: block.timestamp, loadedAt: now };
}

export function chainTimestamp(clock: ChainClock | null, now: number): number {
  if (!clock) return 0;
  return clock.timestamp + Math.max(0, Math.floor((now - clock.loadedAt) / 1000));
}
