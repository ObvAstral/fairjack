import { getAddress, isAddress } from "ethers";

type ContractConfig = {
  tokenAddress: string | null;
  poolAddress: string | null;
  expectedChainId: bigint;
  rpcUrl: string;
  networkName: string;
  nativeCurrencyName: string;
  nativeCurrencySymbol: string;
  blockExplorerUrl: string | null;
  errors: string[];
};

function readAddress(name: "VITE_TOKEN_ADDRESS" | "VITE_POOL_ADDRESS", errors: string[]) {
  const value = import.meta.env[name]?.trim();
  if (!value) {
    errors.push(`${name} non configurato`);
    return null;
  }
  if (!isAddress(value)) {
    errors.push(`${name} non è un indirizzo EVM valido`);
    return null;
  }
  return getAddress(value);
}

const errors: string[] = [];

function readChainId() {
  const rawValue = import.meta.env.VITE_CHAIN_ID?.trim() || "31337";
  try {
    return BigInt(rawValue);
  } catch {
    errors.push("VITE_CHAIN_ID non è valido");
    return 31337n;
  }
}

const expectedChainId = readChainId();
const isLocal = expectedChainId === 31337n;
const isSepolia = expectedChainId === 11155111n;

function readRpcUrl() {
  const value = import.meta.env.VITE_RPC_URL?.trim()
    || (isLocal ? "http://127.0.0.1:8545" : "");
  if (!value) errors.push("VITE_RPC_URL non configurato");
  return value;
}

export const contractConfig: ContractConfig = {
  tokenAddress: readAddress("VITE_TOKEN_ADDRESS", errors),
  poolAddress: readAddress("VITE_POOL_ADDRESS", errors),
  expectedChainId,
  rpcUrl: readRpcUrl(),
  networkName: import.meta.env.VITE_NETWORK_NAME?.trim()
    || (isSepolia ? "Sepolia" : isLocal ? "Hardhat Local" : `Chain ${expectedChainId.toString()}`),
  nativeCurrencyName: import.meta.env.VITE_NATIVE_CURRENCY_NAME?.trim()
    || (isSepolia ? "Sepolia Ether" : "Ether"),
  nativeCurrencySymbol: import.meta.env.VITE_NATIVE_CURRENCY_SYMBOL?.trim() || "ETH",
  blockExplorerUrl: import.meta.env.VITE_BLOCK_EXPLORER_URL?.trim()
    || (isSepolia ? "https://sepolia.etherscan.io" : null),
  errors,
};
