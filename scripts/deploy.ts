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
      rpcUrl: process.env.LOCAL_RPC_URL?.trim() || "http://127.0.0.1:8545",
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

const local = networkName === "localhost";
// Production/testnet always uses an existing Chainlink wrapper, never our mock.
let wrapperAddress: string;
if (local) {
  const mock = await ethers.deployContract("MockVRFWrapper", [tokenAddress]);
  await mock.waitForDeployment();
  wrapperAddress = await mock.getAddress();
} else {
  wrapperAddress = ethers.getAddress(
    process.env.VRF_WRAPPER_ADDRESS?.trim() ||
      "0x195f15F2d49d693cE265b4fB0fdDbE15b1850Cc1",
  );
  if ((await ethers.provider.getCode(wrapperAddress)) === "0x") {
    throw new Error(
      "VRF_WRAPPER_ADDRESS non contiene un contratto sulla rete selezionata.",
    );
  }
}
const feeLimit = ethers.parseEther(
  process.env.VRF_MAX_REQUEST_COST_ETH?.trim() || (local ? "0.001" : "0.005"),
);
if (feeLimit <= 0n)
  throw new Error("VRF_MAX_REQUEST_COST_ETH deve essere positivo.");
const initialReserve = ethers.parseEther(
  process.env.ORACLE_RESERVE_ETH?.trim() || (local ? "0.5" : "0"),
);
if (initialReserve < 0n)
  throw new Error("ORACLE_RESERVE_ETH non può essere negativo.");
const pool = await ethers.deployContract("FairJackPool", [
  tokenAddress,
  wrapperAddress,
  feeLimit,
]);
await pool.waitForDeployment();
const poolAddress = await pool.getAddress();
if (initialReserve > 0n) {
  await (await pool.fundOracle({ value: initialReserve })).wait();
}
console.log(
  `VRF wrapper${local ? " (MOCK locale)" : " Chainlink"}: ${wrapperAddress}`,
);
console.log(`Limite costo per richiesta: ${ethers.formatEther(feeLimit)} ETH`);
console.log(
  `Riserva ETH: ${ethers.formatEther(await pool.getOracleReserve())}`,
);
console.log(
  `Budget per nuova partita: ${ethers.formatEther(
    await pool.getRequiredOracleBudget(),
  )} ETH`,
);

const envContents = [
  "# GENERATO AUTOMATICAMENTE: configurazione di questo deploy.",
  "# Protocollo: FairJack VRF (senza validator / commit-reveal).",
  "# Oracolo: Chainlink VRF v2.5, direct funding pagato dalla pool.",
  `# Rete: ${frontendNetwork.name}; chain ID: ${chainId.toString()}.`,
  `# Generato il (UTC): ${new Date().toISOString()}`,
  "# Deploy precedenti: docs/deployments/sepolia-legacy.md (OBSOLETI).",
  "# Un altro deploy locale/Sepolia sovrascrive questo file: conserva le configurazioni da riutilizzare.",
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

await writeFile(
  new URL("../frontend/.env.local", import.meta.url),
  envContents,
  "utf8",
);

console.log(`MockERC20:    ${tokenAddress}`);
console.log(`FairJackPool: ${poolAddress}`);
console.log(`Chain ID:     ${chainId.toString()}`);
console.log("Configurazione scritta in frontend/.env.local");
