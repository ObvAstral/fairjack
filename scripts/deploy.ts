import { writeFile } from "node:fs/promises";
import { network } from "hardhat";

const { ethers } = await network.create();
const [deployer] = await ethers.getSigners();

console.log(`Deploy da ${deployer.address}`);

const token = await ethers.deployContract("MockERC20");
await token.waitForDeployment();
const tokenAddress = await token.getAddress();

const pool = await ethers.deployContract("FairJackPool", [tokenAddress]);
await pool.waitForDeployment();
const poolAddress = await pool.getAddress();

const { chainId } = await ethers.provider.getNetwork();
const envContents = [
  `VITE_TOKEN_ADDRESS=${tokenAddress}`,
  `VITE_POOL_ADDRESS=${poolAddress}`,
  `VITE_CHAIN_ID=${chainId.toString()}`,
  "VITE_RPC_URL=http://127.0.0.1:8545",
  "",
].join("\n");

await writeFile(new URL("../frontend/.env.local", import.meta.url), envContents, "utf8");

console.log(`MockERC20:    ${tokenAddress}`);
console.log(`FairJackPool: ${poolAddress}`);
console.log(`Chain ID:     ${chainId.toString()}`);
console.log("Configurazione scritta in frontend/.env.local");
