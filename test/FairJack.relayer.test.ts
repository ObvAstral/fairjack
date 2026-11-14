import { expect } from "chai";
import { rejects } from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserProvider, HDNodeWallet, parseEther, parseUnits, Transaction } from "ethers";
import { network } from "hardhat";
import { Store } from "../relayer/src/store.js";
import { RelayEngine } from "../relayer/src/engine.js";
import { createApp } from "../relayer/src/app.js";
import { Dealer } from "../relayer/src/dealer.js";
import { SessionClient } from "../frontend/src/utils/sessionClient.js";
import { actionTypes, sessionDomain } from "../shared/sessions.js";
import type { Operation } from "../shared/sessions.js";

const cleanups: Array<() => Promise<void>> = [];
const pause = () => new Promise((resolve) => setTimeout(resolve, 10));
async function flush(engine: RelayEngine) {
  for (let i = 0; i < 300; ++i) {
    await engine.drain();
    if (!engine.store.pending().length) return;
    await pause();
  }
  throw new Error("Relayer did not finish pending operations");
}
async function fixture(file = ":memory:") {
  const connection = await network.create();
  const { ethers } = connection;
  const [staker, player, outsider] = await ethers.getSigners();
  const token = await ethers.deployContract("MockERC20");
  const oracle = await ethers.deployContract("MockVRFWrapper", [token.target]);
  const pool = await ethers.deployContract("FairJackPool", [token.target, oracle.target, parseEther("0.001")]);
  await token.mint(staker.address, parseEther("1000"));
  await token.approve(pool.target, parseEther("1000"));
  await pool.depositToHousePool(parseEther("1000"));
  await pool.fundOracle({ value: parseEther("0.5") });
  await token.mint(player.address, parseEther("200"));
  await token.connect(player).approve(pool.target, parseEther("200"));
  let walletTransactions = 0;
  const provider = new BrowserProvider({ request: ({ method, params }) => {
    if (method === "eth_sendTransaction") ++walletTransactions;
    return connection.provider.request({ method, params });
  } }, undefined, { cacheTimeout: -1, pollingInterval: 50 });
  const wallet = HDNodeWallet.fromPhrase("test test test test test test test test test test test junk", undefined, "m/44'/60'/0'/0/19").connect(provider);
  const deploymentId = await pool.sessionDeploymentId();
  const scope = `31337:${pool.target}:${deploymentId}`;
  const store = new Store(file, scope);
  const limits = { gasPerTx: 1_500_000n, feePerGas: parseUnits("100", "gwei"), dailyBudget: parseEther("1"), maxSessionBudget: parseEther("100") };
  const engine = new RelayEngine(provider, wallet, 31337n, String(pool.target), deploymentId, store, limits);
  const dealer = new Dealer(engine, true, 0);
  const app = createApp(engine);
  cleanups.push(async () => { dealer.stop(); await flush(engine).catch(() => {}); await app.close(); store.close(); provider.destroy(); await connection.close(); });
  const request: typeof fetch = async (input, init) => {
    const response = await app.inject({ method: (init?.method || "GET") as "GET" | "POST", url: String(input),
      ...(init?.body ? { payload: String(init.body), headers: { "content-type": "application/json" } } : {}),
    });
    return new Response(response.body, { status: response.statusCode, headers: { "content-type": "application/json" } });
  };
  let signatures = 0;
  const signer = { signTypedData: async (...args: Parameters<typeof player.signTypedData>) => { ++signatures; return player.signTypedData(...args); } };
  const client = new SessionClient(provider, signer, player.address, 31337n, String(pool.target), () => {}, request, 10);
  async function deal(gameId: bigint) {
    for (let i = 0; i < 10; ++i) {
      await dealer.tick(); await flush(engine);
      const core = await pool.getGameCore(gameId);
      if (core.state === 3n || core.state === 5n) return;
    }
    throw new Error("Dealer did not process randomness");
  }
  return { connection, pool, token, oracle, player, outsider, provider, wallet, store, engine, app, dealer, client, request, deal,
    counts: () => ({ signatures, walletTransactions }), scope, limits, deploymentId };
}

describe("FairJack relayer and dealer integration", function () {
  this.timeout(30_000);
  afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

  it("runs multiple games with one owner signature, no wallet transactions, and automatic dealing", async function () {
    const f = await fixture();
    await f.client.register(parseEther("100"), parseEther("25"));
    const before = await f.provider.getBalance(f.wallet.address);
    for (let i = 0n; i < 2n; ++i) {
      const op = await f.client.send(0, parseEther("25"));
      expect(op.gameId).to.equal(i.toString());
      await f.deal(i);
      await f.client.send(2, i);
      await f.deal(i);
      expect((await f.pool.getGameCore(i)).state).to.equal(5n);
      expect((await f.pool.getGameCore(i)).player).to.equal(f.player.address);
    }
    expect(f.counts()).to.deep.equal({ signatures: 1, walletTransactions: 0 });
    expect(f.client.session?.remaining).to.equal(parseEther("50"));
    expect(await f.provider.getBalance(f.wallet.address)).to.be.lessThan(before);
  });

  it("deduplicates simultaneous HTTP requests and never places the same wager twice", async function () {
    const f = await fixture(); await f.client.register(parseEther("100"), parseEther("25"));
    const state = f.client.session!;
    const block = await f.provider.send("eth_getBlockByNumber", ["pending", false]);
    const action = { sessionId: state.id, nonce: "0", kind: 0, argument: parseEther("25").toString(), validUntil: String(Number(BigInt(block.timestamp)) + 40) };
    const signature = await state.key.signTypedData(sessionDomain(31337n, String(f.pool.target)), actionTypes, action);
    const responses = await Promise.all(Array.from({ length: 5 }, () => f.app.inject({ method: "POST", url: "/api/actions", payload: { action, signature } })));
    for (const response of responses) expect(response.statusCode, response.body).to.equal(200);
    expect(new Set(responses.map((response) => response.json<Operation>().id)).size).to.equal(1);
    await flush(f.engine);
    expect(await f.pool.nextGameId()).to.equal(1n);
  });

  it("recovers a lost POST response without asking the owner to sign again", async function () {
    const f = await fixture(); let lose = true;
    const request: typeof fetch = async (input, init) => {
      const response = await f.request(input, init);
      if (lose && String(input) === "/api/sessions") { lose = false; throw new Error("Response lost"); }
      return response;
    };
    let signatures = 0;
    const client = new SessionClient(f.provider, { signTypedData: async (...args) => { ++signatures; return f.player.signTypedData(...args); } }, f.player.address, 31337n, String(f.pool.target), () => {}, request, 10);
    await rejects(client.register(parseEther("100"), parseEther("25")), /Response lost/);
    expect(client.pending).not.to.equal(null);
    await client.resume();
    expect(client.session).not.to.equal(null);
    expect(signatures).to.equal(1);
    expect(await f.pool.sessionNonces(f.player.address)).to.equal(1n);
  });

  it("keeps a signed transaction across process restart and rebroadcasts it exactly once", async function () {
    const directory = await mkdtemp(join(tmpdir(), "fairjack-relay-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const f = await fixture();
    await f.client.register(parseEther("100"), parseEther("25"));
    const local = f.client.session!;
    const block = await f.provider.send("eth_getBlockByNumber", ["pending", false]);
    const action = { sessionId: local.id, nonce: "0", kind: 0, argument: parseEther("25").toString(), validUntil: String(Number(BigInt(block.timestamp)) + 40) };
    const signed = await local.key.signTypedData(sessionDomain(31337n, String(f.pool.target)), actionTypes, action);
    const data = f.pool.interface.encodeFunctionData("executeSessionAction", [action, signed]);
    const path = join(directory, "relay.sqlite");
    let store = new Store(path, f.scope);
    const nonce = Number(BigInt(await f.provider.send("eth_getTransactionCount", [f.wallet.address, "pending"])));
    const raw = await f.wallet.signTransaction({ chainId: 31337n, nonce, to: f.pool.target, data, gasLimit: 1_000_000n, type: 2, maxFeePerGas: parseUnits("10", "gwei"), maxPriorityFeePerGas: parseUnits("1", "gwei") });
    store.insert("recover", "action:0", "{}", data, String(f.pool.target));
    store.update("recover", { status: "submitted", raw, nonce, txHash: Transaction.from(raw).hash!, cost: parseEther("0.01").toString() });
    store.close();
    store = new Store(path, f.scope);
    const recovered = new RelayEngine(f.provider, f.wallet, 31337n, String(f.pool.target), f.deploymentId, store, f.limits);
    await flush(recovered); await recovered.drain();
    expect(store.get("recover")?.status).to.equal("confirmed");
    expect(store.games()).to.deep.equal(["0"]);
    expect(await f.pool.nextGameId()).to.equal(1n);
    store.close();
  });

  it("validates request shapes, origin and sponsorship limits before broadcasting", async function () {
    const f = await fixture();
    const invalid = await f.app.inject({ method: "POST", url: "/api/actions", payload: { action: {}, signature: "0x00", target: f.token.target } });
    expect(invalid.statusCode).to.equal(400);
    const origin = await f.app.inject({ method: "POST", url: "/api/sessions", headers: { origin: "https://other.example" }, payload: {} });
    expect(origin.statusCode).to.equal(403);
    f.limits.dailyBudget = 1n;
    const config = await f.app.inject({ method: "GET", url: "/api/config" });
    // Config may still fit no transaction; actual preflight always enforces it.
    expect(config.statusCode).to.equal(200);
    await rejects(f.client.register(parseEther("100"), parseEther("25")), /Budget giornaliero/);
    expect(await f.pool.sessionNonces(f.player.address)).to.equal(0n);
    expect(f.store.pending()).to.have.length(0);
  });

  it("rejects automatic mock fulfillment on a public chain", async function () {
    const f = await fixture();
    const publicEngine = new RelayEngine(f.provider, f.wallet, 11155111n, String(f.pool.target), f.deploymentId, f.store, f.limits);
    expect(() => new Dealer(publicEngine, true)).to.throw("solo su Hardhat Local");
  });

  it("the dealer retries a deferred committed Hit and consumes exactly one new VRF response", async function () {
    const f = await fixture();
    await f.client.register(parseEther("100"), parseEther("25"));
    await f.client.send(0, parseEther("25"));
    await f.deal(0n);
    await f.oracle.setRequestsEnabled(false);
    await f.client.send(1, 0n);
    expect((await f.pool.getGameRandomness(0n)).queued).to.equal(true);
    await f.dealer.tick();
    expect((await f.pool.getGameRandomness(0n)).requestCount).to.equal(1n);
    await f.oracle.setRequestsEnabled(true);
    await f.deal(0n);
    const state = await f.pool.getGameRandomness(0n);
    expect(state.queued).to.equal(false);
    expect(state.consumed).to.equal(true);
    expect(state.requestCount).to.equal(2n);
  });

  it("a fresh page renews the session and can resume the existing player's hand", async function () {
    const f = await fixture();
    await f.client.register(parseEther("100"), parseEther("25"));
    await f.client.send(0, parseEther("25")); await f.deal(0n);
    const reloaded = new SessionClient(f.provider, f.player, f.player.address, 31337n, String(f.pool.target), () => {}, f.request, 10);
    expect(reloaded.session).to.equal(null);
    await reloaded.register(parseEther("100"), parseEther("25"));
    await rejects(f.client.send(1, 0n), /Apri o rinnova/);
    await reloaded.send(2, 0n); await f.deal(0n);
    expect((await f.pool.getGameCore(0n)).state).to.equal(5n);
  });

  it("the dealer settles an expired player turn without making a player choice", async function () {
    const f = await fixture();
    await f.client.register(parseEther("100"), parseEther("25"));
    await f.client.send(0, parseEther("25")); await f.deal(0n);
    await f.connection.networkHelpers.time.increase(301);
    await f.dealer.tick(); await flush(f.engine);
    expect((await f.pool.getGameCore(0n)).state).to.equal(5n);
    expect((await f.pool.getGameResult(0n)).result).to.equal(2n);
  });

  it("halts persisted jobs when the chain rolls back", async function () {
    const f = await fixture();
    const snapshot = await f.connection.networkHelpers.takeSnapshot();
    await f.client.register(parseEther("100"), parseEther("25"));
    await snapshot.restore();
    await rejects(f.engine.checkChain(), /ripristinata|riorganizzata/);
    expect(f.engine.halted).not.to.equal(null);
  });
});
