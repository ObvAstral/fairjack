import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

const mocks = vi.hoisted(() => ({
  chainId: 31337n,
  getCode: vi.fn(),
  request: vi.fn(),
}));
vi.mock("../src/config/contracts", () => ({
  contractConfig: {
    errors: [],
    tokenAddress: "token",
    poolAddress: "pool",
    expectedChainId: 31337n,
    networkName: "Hardhat Local",
    nativeCurrencyName: "Ether",
    nativeCurrencySymbol: "ETH",
    rpcUrl: "http://127.0.0.1:8545",
    blockExplorerUrl: null,
  },
}));
vi.mock("../src/utils/walletSigner", () => ({
  createWalletSigner: async () => ({
    getAddress: async () => "0x0000000000000000000000000000000000000001",
  }),
}));
vi.mock("ethers", async (original) => ({
  ...(await original<typeof import("ethers")>()),
  BrowserProvider: class {
    getNetwork = async () => ({ chainId: mocks.chainId });
    getCode = mocks.getCode;
    send = async () => "0x4";
  },
  Contract: class {
    vrfWrapper = async () => "oracle";
  },
}));
vi.mock("../src/components/GameSessionProvider", () => ({
  default: () => <div>Protocollo pronto</div>,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  mocks.chainId = 31337n;
  mocks.getCode.mockReset().mockResolvedValue("0x1234");
  mocks.request
    .mockReset()
    .mockResolvedValue(["0x0000000000000000000000000000000000000001"]);
  vi.stubGlobal("ethereum", undefined);
  Object.defineProperty(window, "ethereum", {
    configurable: true,
    value: { request: mocks.request, on: vi.fn(), removeListener: vi.fn() },
  });
});
afterEach(() => {
  delete window.ethereum;
  vi.unstubAllGlobals();
});
describe("wallet and deployment loading", () => {
  it("waits for deployment validation before enabling the application", async () => {
    const code = deferred<string>();
    mocks.getCode.mockReturnValue(code.promise);
    render(<App />);
    await screen.findByText("Verifica dei contratti…");
    expect(screen.queryByText("Protocollo pronto")).toBeNull();
    expect(screen.queryByText("Deploy non trovato")).toBeNull();
    await act(async () => {
      code.resolve("0x1234");
    });
    await screen.findByText("Protocollo pronto");
    expect(screen.queryByText("Verifica dei contratti…")).toBeNull();
  });
  it("keeps a rejected add-network error visible and releases the switch control", async () => {
    mocks.chainId = 1n;
    mocks.request.mockImplementation(async ({ method }: { method: string }) => {
      if (method === "wallet_switchEthereumChain") throw { code: 4902 };
      if (method === "wallet_addEthereumChain")
        throw new Error("Aggiunta rete rifiutata");
      return ["0x0000000000000000000000000000000000000001"];
    });
    render(<App />);
    const change = await screen.findByRole("button", {
      name: "Passa a Hardhat Local",
    });
    fireEvent.click(change);
    fireEvent.click(change);
    await screen.findByText("Aggiunta rete rifiutata");
    await waitFor(() =>
      expect((change as HTMLButtonElement).disabled).toBe(false)
    );
    expect(
      mocks.request.mock.calls.filter(
        ([request]) => request.method === "wallet_switchEthereumChain"
      )
    ).toHaveLength(1);
  });
});
