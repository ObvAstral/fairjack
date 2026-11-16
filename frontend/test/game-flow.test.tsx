import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserProvider, JsonRpcSigner } from "ethers";
import StartGame from "../src/components/StartGame";
import GameBoard from "../src/components/GameBoard";
import SessionPanel from "../src/components/SessionPanel";
import {
  GameSessionContext,
  type GameSessionContext as SessionContext,
} from "../src/utils/useGameSession";
import type { Confirmation } from "../src/utils/async";

const mocks = vi.hoisted(() => ({ contract: {} as Record<string, unknown> }));
vi.mock("../src/config/contracts", () => ({
  contractConfig: {
    poolAddress: "pool",
    tokenAddress: "token",
    expectedChainId: 31337n,
  },
}));
vi.mock("ethers", async (original) => ({
  ...(await original<typeof import("ethers")>()),
  Contract: class {
    constructor() {
      return mocks.contract;
    }
  },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const account = "0x0000000000000000000000000000000000000001";
let count: bigint, block: number, failRead: boolean;
const send = vi.fn(async () => `0x${block.toString(16)}`);
const receipt = {
  hash: "confirmed-tx",
  blockNumber: 5,
  status: 1,
  logs: [{ topics: [], data: "0x" }],
};
const provider = {
  send,
  getBlock: vi.fn(async () => ({ hash: "block", timestamp: 1000 })),
  getTransactionReceipt: vi.fn(async () => receipt),
} as unknown as BrowserProvider;
const signer = {} as JsonRpcSigner;
function session(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    initializing: false,
    phase: null,
    walletMode: true,
    setWalletMode: vi.fn(),
    active: true,
    busy: false,
    revoking: false,
    pending: false,
    status: null,
    error: null,
    available: true,
    unavailable: null,
    dealer: false,
    remaining: 100n,
    maxBet: 25n,
    expiresAt: 0,
    secondsLeft: 1800,
    open: vi.fn(),
    revoke: vi.fn(),
    resume: vi.fn(),
    send: vi.fn(),
    ...overrides,
  };
}
const core = (id: bigint) => ({
  player: account,
  bet: 25n * 10n ** 18n,
  maxPayout: 50n * 10n ** 18n,
  state: id === 0n ? 1n : 3n,
});
beforeEach(() => {
  count = 0n;
  block = 4;
  failRead = false;
  vi.clearAllMocks();
  mocks.contract = {
    MIN_BET: vi.fn(async () => 10n ** 18n),
    MAX_BET: vi.fn(async () => 100n * 10n ** 18n),
    decimals: vi.fn(async () => 18n),
    nextGameId: vi.fn(async () => {
      if (failRead) throw new Error("RPC non disponibile");
      return count;
    }),
    getGameCore: vi.fn(async (id: bigint) => core(id)),
    getGameRandomness: vi.fn(async () => ({
      requestId: 1n,
      phase: 0n,
      requestCount: 1n,
      fulfilled: false,
      consumed: false,
      queued: false,
      oracleSpent: 0n,
      oracleBudgetRemaining: 1n,
    })),
    getActionDeadline: vi.fn(async () => 0n),
    getPlayerCards: vi.fn(async () => []),
    getDealerCards: vi.fn(async () => []),
    getPlayerScore: vi.fn(async () => 0n),
    getDealerScore: vi.fn(async () => 0n),
    getGameResult: vi.fn(async () => ({ result: 0n, payout: 0n })),
    interface: {
      parseLog: () => ({ name: "PoolGameStarted", args: { gameId: 0n } }),
    },
  };
});
function Flow({
  context = session(),
  initialId = 0n,
  initialExplicit = false,
}: {
  context?: SessionContext;
  initialId?: bigint;
  initialExplicit?: boolean;
}) {
  const [selection, setSelection] = useState({
    id: initialId,
    revision: 0,
    explicit: initialExplicit,
  });
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [nonce, setNonce] = useState(0);
  const props = {
    provider,
    signer,
    account,
    chainId: 31337n,
    refreshNonce: nonce,
    confirmation,
    onTransactionConfirmed: (confirmed?: Confirmation) => {
      setConfirmation(confirmed);
      setNonce((n) => n + 1);
    },
  };
  const select = (id: bigint) =>
    setSelection((previous) => ({
      id,
      revision: previous.revision + 1,
      explicit: true,
    }));
  return (
    <GameSessionContext.Provider value={context}>
      <StartGame {...props} onGameStarted={select} />
      <GameBoard
        {...props}
        selectedGameId={selection.id}
        selectionRevision={selection.revision}
        selectionExplicit={selection.explicit}
        onSelectGame={select}
      />
    </GameSessionContext.Provider>
  );
}
describe("game loading UI", () => {
  it("shows initial loading before declaring that no games exist", async () => {
    render(<Flow />);
    expect(screen.getByText("Caricamento partita…")).toBeTruthy();
    expect(screen.queryByText(/Non esistono ancora partite/)).toBeNull();
    await screen.findByText(/Non esistono ancora partite/);
    expect(screen.queryByText("Partita inesistente.")).toBeNull();
  });
  it.each([true, false])(
    "creates game zero without a transient missing-game error (wallet=%s)",
    async (walletMode) => {
      const mining = deferred<typeof receipt>();
      const wait = vi.fn(() => mining.promise);
      const start = vi.fn(async () => ({ hash: receipt.hash, wait }));
      mocks.contract.startPoolGame = start;
      const relaySend = vi.fn(async () => {
        await mining.promise;
        return {
          id: "op",
          status: "confirmed" as const,
          gameId: "0",
          txHash: receipt.hash,
        };
      });
      render(
        <Flow
          context={session({
            walletMode,
            send: relaySend,
            dealer: !walletMode,
          })}
        />
      );
      const create = screen.getByRole("button", { name: "Crea partita" });
      await waitFor(() =>
        expect((create as HTMLButtonElement).disabled).toBe(false)
      );
      fireEvent.click(create);
      fireEvent.click(create);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Creazione…" })).toBeTruthy()
      );
      expect(start.mock.calls.length + relaySend.mock.calls.length).toBe(1);
      expect(screen.queryByText("Partita inesistente.")).toBeNull();
      // The wallet RPC remains behind the block already confirmed by the relayer.
      count = 1n;
      await act(async () => {
        mining.resolve(receipt);
      });
      expect(screen.queryByText("Partita inesistente.")).toBeNull();
      expect(screen.queryByText("Partita #0")).toBeNull();
      block = 5;
      await screen.findByText("Partita #0", {}, { timeout: 2500 });
      expect(screen.queryByText("Partita inesistente.")).toBeNull();
      expect(
        screen.getByText(/Attesa della risposta dell’oracolo/)
      ).toBeTruthy();
      const getCore = mocks.contract.getGameCore as ReturnType<typeof vi.fn>;
      expect(
        getCore.mock.calls.every(
          ([, overrides]) => (overrides as { blockTag: number }).blockTag >= 5
        )
      ).toBe(true);
    }
  );
  it("reports a genuinely missing manually opened game after loading", async () => {
    render(<Flow initialId={99n} initialExplicit />);
    expect(screen.queryByText("Partita inesistente.")).toBeNull();
    await screen.findByText("Partita inesistente.");
  });
  it("reloads the same ID and ignores a slower previous selection", async () => {
    count = 3n;
    const slow = deferred<ReturnType<typeof core>>();
    const read = vi.fn(async (id: bigint) =>
      id === 1n ? slow.promise : core(id)
    );
    mocks.contract.getGameCore = read;
    render(<Flow />);
    await screen.findByText("Partita #0");
    fireEvent.click(screen.getByRole("button", { name: "Apri partita" }));
    expect(screen.queryByText("Partita #0")).toBeNull();
    await screen.findByText("Partita #0");
    expect(read.mock.calls.filter(([id]) => id === 0n)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("ID partita"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apri partita" }));
    await waitFor(() => expect(read).toHaveBeenCalledWith(1n, { blockTag: 4 }));
    fireEvent.change(screen.getByLabelText("ID partita"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apri partita" }));
    await screen.findByText("Partita #2");
    await act(async () => {
      slow.resolve(core(1n));
    });
    expect(screen.getByText("Partita #2")).toBeTruthy();
    expect(screen.queryByText("Partita #1")).toBeNull();
  });
  it("hides feedback from a previous game when a new selection begins loading", async () => {
    count = 3n;
    mocks.contract.hit = vi
      .fn()
      .mockRejectedValue(new Error("Errore della partita precedente"));
    render(<Flow initialId={1n} initialExplicit />);
    await screen.findByText("Partita #1");
    fireEvent.click(screen.getByRole("button", { name: "Hit" }));
    await screen.findByText("Errore della partita precedente");
    fireEvent.change(screen.getByLabelText("ID partita"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apri partita" }));
    expect(screen.queryByText("Errore della partita precedente")).toBeNull();
    await screen.findByText("Partita #2");
  });
  it("releases the create button after a wallet rejection", async () => {
    mocks.contract.startPoolGame = vi
      .fn()
      .mockRejectedValue(new Error("Operazione rifiutata nel wallet."));
    render(<Flow />);
    const create = screen.getByRole("button", { name: "Crea partita" });
    await waitFor(() =>
      expect((create as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(create);
    await screen.findByText("Operazione rifiutata nel wallet.");
    expect(
      (
        screen.getByRole("button", {
          name: "Crea partita",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });
  it("blocks new wagers after a confirmed transaction fails to synchronize, and retries only the read", async () => {
    const mining = deferred<typeof receipt>();
    const start = vi.fn(async () => ({
      hash: receipt.hash,
      wait: () => mining.promise,
    }));
    mocks.contract.startPoolGame = start;
    render(<Flow />);
    const create = screen.getByRole("button", { name: "Crea partita" });
    await waitFor(() =>
      expect((create as HTMLButtonElement).disabled).toBe(false)
    );
    fireEvent.click(create);
    count = 1n;
    block = 5;
    failRead = true;
    await act(async () => {
      mining.resolve(receipt);
    });
    await screen.findAllByText(
      /Operazione confermata, dati non ancora aggiornati/
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Crea partita",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    failRead = false;
    for (const retry of screen.getAllByRole("button", {
      name: "Riprova aggiornamento",
    }))
      fireEvent.click(retry);
    await screen.findByText("Partita #0");
    expect(start).toHaveBeenCalledTimes(1);
  });
  it("offers a read-only retry after an RPC failure", async () => {
    failRead = true;
    const start = vi.fn();
    mocks.contract.startPoolGame = start;
    render(<Flow />);
    await screen.findAllByText("RPC non disponibile");
    failRead = false;
    fireEvent.click(
      screen.getAllByRole("button", { name: "Riprova aggiornamento" })[1]
    );
    await screen.findByText(/Non esistono ancora partite/);
    expect(start).not.toHaveBeenCalled();
  });
});
describe("session feedback", () => {
  it("shows connecting without reporting a relayer error prematurely", () => {
    render(
      <GameSessionContext.Provider
        value={session({ initializing: true, available: false })}
      >
        <SessionPanel />
      </GameSessionContext.Provider>
    );
    expect(screen.getByText("Collegamento al relayer…")).toBeTruthy();
    expect(screen.queryByText(/Relayer non disponibile/)).toBeNull();
  });
  it("keeps verification and owner revocation available after an uncertain response", () => {
    const context = session({
      pending: true,
      available: false,
      error: "Risposta persa",
    });
    render(
      <GameSessionContext.Provider value={context}>
        <SessionPanel />
      </GameSessionContext.Provider>
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Verifica operazione" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Revoca dal wallet" }));
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(context.revoke).toHaveBeenCalledTimes(1);
    expect(
      (
        screen.getByRole("button", {
          name: "Rinnova sessione",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});
