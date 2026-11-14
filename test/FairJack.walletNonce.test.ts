import { rejects } from "node:assert/strict";
import { expect } from "chai";
import { BrowserProvider, isError, toQuantity } from "ethers";
import { network } from "hardhat";
import { createWalletSigner } from "../frontend/src/utils/walletSigner.js";
import { readableError } from "../frontend/src/utils/errors.js";

const cleanups: Array<() => Promise<void>> = [];

async function walletFixture(chainId = 31337) {
  const connection = await network.create({ override: { chainId } });
  const [account, recipient] = await connection.ethers.getSigners();
  const transactions: Array<Record<string, unknown>> = [];
  const wallet = {
    cachedNonce: 10,
    rejectNext: false,
    ignoreExplicitNonce: false,
    reportedChainId: null as string | null,
  };
  const provider = new BrowserProvider({
    async request({ method, params }) {
      if (method === "eth_chainId" && wallet.reportedChainId !== null)
        return wallet.reportedChainId;
      if (method === "eth_sendTransaction") {
        const [tx] = params as [Record<string, unknown>];
        transactions.push(tx);
        if (wallet.rejectNext) {
          wallet.rejectNext = false;
          throw Object.assign(new Error("User rejected the transaction"), { code: 4001 });
        }
        // Some wallets accept a dapp nonce. Others, including MetaMask,
        // select it internally and need their stale activity cleared.
        return connection.provider.request({
          method,
          params: [{
            ...tx,
            nonce: wallet.ignoreExplicitNonce
              ? toQuantity(wallet.cachedNonce)
              : tx.nonce ?? toQuantity(wallet.cachedNonce),
          }],
        });
      }
      return connection.provider.request({ method, params });
    },
  }, undefined, { cacheTimeout: -1 });
  cleanups.push(async () => {
    provider.destroy();
    await connection.close();
  });
  const signer = await createWalletSigner(provider, account.address);
  return { connection, account, recipient, provider, signer, transactions, wallet };
}

describe("FairJack frontend wallet nonces", function () {
  afterEach(async function () {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("reproduces expected nonce 4 / wallet nonce 10 and corrects it on a compatible wallet", async function () {
    const f = await walletFixture();
    for (let i = 0; i < 4; ++i)
      await (await f.account.sendTransaction({ to: f.recipient.address, value: 1n })).wait();

    const ordinarySigner = await f.provider.getSigner(f.account.address);
    await rejects(
      ordinarySigner.sendTransaction({ to: f.recipient.address, value: 1n }),
      /Nonce too high\. Expected nonce to be 4 but got 10/,
    );

    const tx = await f.signer.sendTransaction({ to: f.recipient.address, value: 1n });
    expect(tx.nonce).to.equal(4);
    expect((await tx.wait())?.status).to.equal(1);
    expect(f.transactions.at(-1)?.nonce).to.equal("0x4");
    expect(f.transactions.at(-1)?.chainId).to.equal("0x7a69");
  });

  it("explains how to recover when a wallet ignores the explicit nonce", async function () {
    const f = await walletFixture();
    f.wallet.ignoreExplicitNonce = true;
    for (let i = 0; i < 4; ++i)
      await (await f.account.sendTransaction({ to: f.recipient.address, value: 1n })).wait();

    await rejects(
      f.signer.sendTransaction({ to: f.recipient.address, value: 1n }),
      (error) => {
        const message = readableError(error);
        expect(message).to.include("Il wallet usa il nonce 10, ma la rete attende 4.");
        expect(message).to.include("Delete activity and nonce data");
        return true;
      },
    );

    // Simulate the user clearing stale wallet activity on the local network.
    f.wallet.cachedNonce = 4;
    const tx = await f.signer.sendTransaction({ to: f.recipient.address, value: 1n });
    expect(tx.nonce).to.equal(4);
    expect((await tx.wait())?.status).to.equal(1);
  });

  it("finds nonce details inside nested wallet RPC errors", function () {
    const error = {
      shortMessage: "could not coalesce error",
      info: { error: { data: {
        originalError: { message: "Nonce too high. Expected nonce to be 4 but got 10." },
      } } },
    };
    expect(readableError(error)).to.include("Il wallet usa il nonce 10, ma la rete attende 4.");
    // Error envelopes can contain circular references.
    Object.assign(error, { cause: error });
    expect(readableError(error)).to.include("Hardhat Local (31337)");
  });

  it("resynchronizes the same signer when the local chain rolls back from nonce 10 to 4", async function () {
    const f = await walletFixture();
    for (let i = 0; i < 4; ++i)
      await (await f.signer.sendTransaction({ to: f.recipient.address, value: 1n })).wait();
    const snapshot = await f.connection.networkHelpers.takeSnapshot();
    for (let i = 4; i < 10; ++i)
      await (await f.signer.sendTransaction({ to: f.recipient.address, value: 1n })).wait();

    await snapshot.restore();
    const tx = await f.signer.sendTransaction({ to: f.recipient.address, value: 1n });
    expect(tx.nonce).to.equal(4);
    expect((await tx.wait())?.status).to.equal(1);
  });

  it("serializes simultaneous sends from the shared signer without reusing a nonce", async function () {
    const f = await walletFixture();
    const txs = await Promise.all([1n, 2n, 3n].map((value) =>
      f.signer.sendTransaction({ to: f.recipient.address, value }),
    ));
    expect(txs.map((tx) => tx.nonce)).to.deep.equal([0, 1, 2]);
    for (const tx of txs) expect((await tx.wait())?.status).to.equal(1);
  });

  it("releases the queue after a wallet rejection without skipping a nonce", async function () {
    const f = await walletFixture();
    f.wallet.rejectNext = true;
    await rejects(
      f.signer.sendTransaction({ to: f.recipient.address, value: 1n }),
      (error) => isError(error, "ACTION_REJECTED"),
    );
    const tx = await f.signer.sendTransaction({ to: f.recipient.address, value: 1n });
    expect(tx.nonce).to.equal(0);
    expect((await tx.wait())?.status).to.equal(1);
  });

  it("leaves nonce selection to the wallet on Sepolia", async function () {
    const f = await walletFixture(11155111);
    f.wallet.cachedNonce = 0;
    const tx = await f.signer.sendTransaction({ to: f.recipient.address, value: 1n });
    expect((await tx.wait())?.status).to.equal(1);
    expect(f.transactions[0].nonce).to.equal(undefined);
  });

  it("stops a local send if the wallet has switched to another chain", async function () {
    const f = await walletFixture();
    f.wallet.reportedChainId = "0xaa36a7";
    await rejects(
      f.signer.sendUncheckedTransaction({ to: f.recipient.address, value: 1n }),
      /La rete del wallet è cambiata/,
    );
    expect(f.transactions).to.have.length(0);
  });
});
