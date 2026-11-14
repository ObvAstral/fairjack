import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { HDNodeWallet, JsonRpcProvider, Wallet, getAddress, parseEther, parseUnits } from "ethers";
import type { BaseWallet } from "ethers";
import fastifyStatic from "@fastify/static";
import { fairJackPoolAbi } from "../../frontend/src/contracts/abis.js";
import { Contract } from "ethers";
import { Store } from "./store.js";
import { RelayEngine } from "./engine.js";
import { Dealer } from "./dealer.js";
import { createApp } from "./app.js";

type Deployment = { chainId?: string; pool?: string; rpcUrl?: string; mock?: boolean; wrapper?: string };
let deployment: Deployment = {};
try { deployment = JSON.parse(await readFile(resolve("relayer/deployment.json"), "utf8")); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const chainId = BigInt(process.env.RELAYER_CHAIN_ID || deployment.chainId || "31337");
if (chainId !== 31337n && chainId !== 11155111n) throw new Error("Il relayer supporta Hardhat Local e Sepolia.");
const local = chainId === 31337n;
function required(name: string, localDefault?: string) {
  const value = process.env[name]?.trim() || (local ? localDefault : undefined);
  if (!value) throw new Error(`${name} deve essere configurato prima di avviare il relayer.`);
  return value;
}
const rpcUrl = process.env.RELAYER_RPC_URL?.trim() || deployment.rpcUrl || (local ? "http://127.0.0.1:8545" : "");
if (!rpcUrl) throw new Error("RELAYER_RPC_URL non configurato.");
const poolAddress = getAddress(process.env.RELAYER_POOL_ADDRESS?.trim() || deployment.pool || "");
const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1, batchMaxCount: 1, pollingInterval: 1000 });
if ((await provider.getNetwork()).chainId !== chainId) throw new Error("Chain ID del relayer diverso da quello dell’RPC.");
let wallet: BaseWallet;
if (process.env.RELAYER_PRIVATE_KEY) wallet = new Wallet(process.env.RELAYER_PRIVATE_KEY, provider);
else if (local) {
  // Public Hardhat development mnemonic, used ONLY on chain 31337. Account 19
  // is separate from the deployer and the normal player/staker fixtures.
  wallet = HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, "m/44'/60'/0'/0/19").connect(provider);
} else throw new Error("RELAYER_PRIVATE_KEY non configurata sul server.");
const limits = {
  gasPerTx: BigInt(required("RELAYER_MAX_GAS_PER_TX", "1500000")),
  feePerGas: parseUnits(required("RELAYER_MAX_FEE_GWEI", "100"), "gwei"),
  dailyBudget: parseEther(required("RELAYER_DAILY_BUDGET_ETH", "1")),
  maxSessionBudget: parseEther(process.env.RELAYER_MAX_SESSION_BUDGET_FJT || "100"),
};
if (Object.values(limits).some((value) => value <= 0n)) throw new Error("I limiti del relayer devono essere positivi.");
const pool = new Contract(poolAddress, fairJackPoolAbi, provider);
const deploymentId = await pool.sessionDeploymentId() as string;
const dbPath = resolve(process.env.RELAYER_DB_PATH || "relayer/data/relay.sqlite");
await mkdir(resolve(dbPath, ".."), { recursive: true });
const store = new Store(dbPath, `${chainId}:${poolAddress.toLowerCase()}:${deploymentId}`);
const engine = new RelayEngine(provider, wallet, chainId, poolAddress, deploymentId, store, limits);
const autoFulfill = process.env.DEALER_AUTO_FULFILL === undefined
  ? local && deployment.mock === true
  : process.env.DEALER_AUTO_FULFILL === "true";
if (autoFulfill) {
  if (!local || !deployment.mock || (await pool.vrfWrapper() as string).toLowerCase() !== deployment.wrapper?.toLowerCase())
    throw new Error("Il dealer richiede il deploy del mock Hardhat per simulare VRF.");
}
const dealer = new Dealer(engine, autoFulfill);
const trustedProxies = process.env.RELAYER_TRUST_PROXY?.split(",").map((ip) => ip.trim()).filter(Boolean);
const app = createApp(engine, process.env.RELAYER_ALLOWED_ORIGIN || "http://localhost:5173", trustedProxies?.length ? trustedProxies : false);
const frontend = resolve("frontend/dist");
if (existsSync(frontend)) {
  await app.register(fastifyStatic, { root: frontend });
  app.setNotFoundHandler((request, reply) => request.url.startsWith("/api/")
    ? reply.code(404).send({ error: "Endpoint non trovato." }) : reply.sendFile("index.html"));
}
await engine.checkChain();
await app.listen({ host: process.env.RELAYER_HOST || "127.0.0.1", port: Number(process.env.RELAYER_PORT || "3001") });
dealer.start();
console.log(`Relayer attivo su chain ${chainId}; pool ${poolAddress}; gas payer ${wallet.address}; dealer ${autoFulfill ? "con mock automatico locale" : "con VRF reale"}.`);
async function close() {
  dealer.stop();
  await app.close();
  // Transactions are persisted before broadcast and reconciled on restart.
  provider.destroy();
  process.exit(0);
}
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
