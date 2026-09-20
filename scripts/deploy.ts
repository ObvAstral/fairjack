import { writeFile } from "node:fs/promises";
import { network } from "hardhat";

const connection = await network.create();
const { ethers, networkName } = connection;

type FrontendNetwork = {
  name: string;
  rpcUrl: string;
  nativeCurrencyName: string;
  nativeCurrencySymbol: string;
  blockExplorerUrl?: string;
};

function getFrontendNetwork(): FrontendNetwork {
  if (networkName === "localhost") {
    return {
      name: "Hardhat Local",
      rpcUrl: "http://127.0.0.1:8545",
      nativeCurrencyName: "Local Ether",
      nativeCurrencySymbol: "ETH",
    };
  }

  if (networkName === "sepolia") {
    const publicRpcUrl = process.env.SEPOLIA_PUBLIC_RPC_URL?.trim();
    if (!publicRpcUrl) {
      throw new Error(
        "SEPOLIA_PUBLIC_RPC_URL non configurato: indica un endpoint browser-safe, separato dall'RPC privato di deploy.",
      );
    }
    return {
      name: "Sepolia",
      rpcUrl: publicRpcUrl,
      nativeCurrencyName: "Sepolia Ether",
      nativeCurrencySymbol: "ETH",
      blockExplorerUrl: "https://sepolia.etherscan.io",
    };
  }

  throw new Error(`Rete di deploy non supportata dallo script: ${networkName}`);
}

const frontendNetwork = getFrontendNetwork();
const expectedChainId = networkName === "sepolia" ? 11155111n : 31337n;
const { chainId } = await ethers.provider.getNetwork();
if (chainId !== expectedChainId) {
  throw new Error(
    `Chain ID inatteso per ${networkName}: ricevuto ${chainId.toString()}, atteso ${expectedChainId.toString()}.`,
  );
}

const [deployer] = await ethers.getSigners();

console.log(`Deploy su ${frontendNetwork.name} da ${deployer.address}`);

const token = await ethers.deployContract("MockERC20");
await token.waitForDeployment();
const tokenAddress = await token.getAddress();

const pool = await ethers.deployContract("FairJackPool", [tokenAddress]);
await pool.waitForDeployment();
const poolAddress = await pool.getAddress();

const envContents = [
  `VITE_TOKEN_ADDRESS=${tokenAddress}`,
  `VITE_POOL_ADDRESS=${poolAddress}`,
  `VITE_CHAIN_ID=${chainId.toString()}`,
  `VITE_RPC_URL=${frontendNetwork.rpcUrl}`,
  `VITE_NETWORK_NAME=${frontendNetwork.name}`,
  `VITE_NATIVE_CURRENCY_NAME=${frontendNetwork.nativeCurrencyName}`,
  `VITE_NATIVE_CURRENCY_SYMBOL=${frontendNetwork.nativeCurrencySymbol}`,
  `VITE_BLOCK_EXPLORER_URL=${frontendNetwork.blockExplorerUrl ?? ""}`,
  "",
].join("\n");

await writeFile(new URL("../frontend/.env.local", import.meta.url), envContents, "utf8");

console.log(`MockERC20:    ${tokenAddress}`);
console.log(`FairJackPool: ${poolAddress}`);
console.log(`Chain ID:     ${chainId.toString()}`);
console.log("Configurazione scritta in frontend/.env.local");
