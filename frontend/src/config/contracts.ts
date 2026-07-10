import { getAddress, isAddress } from "ethers";

type ContractConfig = {
  tokenAddress: string | null;
  poolAddress: string | null;
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

export const contractConfig: ContractConfig = {
  tokenAddress: readAddress("VITE_TOKEN_ADDRESS", errors),
  poolAddress: readAddress("VITE_POOL_ADDRESS", errors),
  errors,
};
