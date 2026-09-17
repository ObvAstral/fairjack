import { getAddress, isAddress } from "ethers";

type ContractConfig = {
  tokenAddress: string | null;
  poolAddress: string | null;
  expectedChainId: bigint;
  rpcUrl: string;
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

export const contractConfig: ContractConfig = {
  tokenAddress: readAddress("VITE_TOKEN_ADDRESS", errors),
  poolAddress: readAddress("VITE_POOL_ADDRESS", errors),
  expectedChainId: readChainId(),
  rpcUrl: import.meta.env.VITE_RPC_URL?.trim() || "http://127.0.0.1:8545",
  errors,
};
