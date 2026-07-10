interface InjectedEthereumProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on(event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void): void;
  removeListener(event: "accountsChanged" | "chainChanged", listener: (...args: unknown[]) => void): void;
}

interface Window {
  ethereum?: InjectedEthereumProvider;
}
