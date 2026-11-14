import { expect } from "chai";
import { Wallet, TypedDataEncoder } from "ethers";
import { createPool, fulfillAndProcess, reachPlayerTurn, TEST_BET } from "./helpers/gameHelpers.js";
import { ethers, networkHelpers } from "./helpers/deployFixture.js";
import { grantTypes, actionTypes, sessionDomain } from "../shared/sessions.js";
import type { SessionAction, SessionGrant } from "../shared/sessions.js";

type Fixture = Awaited<ReturnType<typeof createPool>>;
async function authorize(f: Fixture, overrides: Partial<SessionGrant> = {}) {
  const key = Wallet.createRandom();
  const grant: SessionGrant = {
    player: f.player.address, sessionKey: key.address,
    nonce: (await f.pool.sessionNonces(overrides.player || f.player.address)).toString(),
    validUntil: String(await networkHelpers.time.latest() + 600),
    maxBet: TEST_BET.toString(), budget: ethers.parseEther("100").toString(),
    deploymentId: await f.pool.sessionDeploymentId(), ...overrides,
  };
  const domain = sessionDomain(f.chainId, String(f.pool.target));
  const signature = await f.player.signTypedData(domain, grantTypes, grant);
  await f.pool.connect(f.outsider).registerSession(grant, signature);
  return { key, grant, domain, signature, id: TypedDataEncoder.hash(domain, grantTypes, grant) };
}
async function signedAction(f: Fixture, session: Awaited<ReturnType<typeof authorize>>, kind = 0, argument = TEST_BET) {
  const state = await f.pool.getSession(session.id);
  const action: SessionAction = {
    sessionId: session.id, nonce: state.actionNonce.toString(), kind, argument: argument.toString(),
    validUntil: String(Math.min(await networkHelpers.time.latest() + 45, Number(session.grant.validUntil))),
  };
  return { action, signature: await session.key.signTypedData(session.domain, actionTypes, action) };
}

describe("FairJack bounded game sessions", function () {
  it("allows sponsored gameplay while retaining the player and paying winnings to that player", async function () {
    const f = await createPool();
    const s = await authorize(f);
    const start = await signedAction(f, s);
    const before = await f.token.balanceOf(f.player.address);
    await f.pool.connect(f.outsider).executeSessionAction(start.action, start.signature);
    expect((await f.pool.getGameCore(0n)).player).to.equal(f.player.address);
    expect(await f.token.balanceOf(f.outsider.address)).to.equal(ethers.parseEther("10000"));
    await fulfillAndProcess(f);
    const stand = await signedAction(f, s, 2, 0n);
    await f.pool.connect(f.outsider).executeSessionAction(stand.action, stand.signature);
    if ((await f.pool.getGameCore(0n)).state === 1n) await fulfillAndProcess(f);
    const result = await f.pool.getGameResult(0n);
    expect(await f.token.balanceOf(f.player.address)).to.equal(before - TEST_BET + result.payout);
    expect((await f.pool.getSession(s.id)).remainingBudget).to.equal(ethers.parseEther("75"));
  });

  it("rejects replayed grants, replayed actions and altered arguments", async function () {
    const f = await createPool(); const s = await authorize(f);
    await expect(f.pool.registerSession(s.grant, s.signature)).to.be.revertedWithCustomError(f.pool, "InvalidSessionNonce");
    const a = await signedAction(f, s);
    await expect(f.pool.executeSessionAction({ ...a.action, argument: ethers.parseEther("1") }, a.signature)).to.be.revertedWithCustomError(f.pool, "InvalidSessionSignature");
    await f.pool.executeSessionAction(a.action, a.signature);
    await expect(f.pool.executeSessionAction(a.action, a.signature)).to.be.revertedWithCustomError(f.pool, "InvalidSessionNonce");
    expect(await f.pool.nextGameId()).to.equal(1n);
  });

  it("rejects signatures from another key, network or verifying contract", async function () {
    const f = await createPool(); const s = await authorize(f); const a = await signedAction(f, s);
    for (const signature of [
      await Wallet.createRandom().signTypedData(s.domain, actionTypes, a.action),
      await s.key.signTypedData({ ...s.domain, chainId: f.chainId + 1n }, actionTypes, a.action),
      await s.key.signTypedData({ ...s.domain, verifyingContract: String(f.token.target) }, actionTypes, a.action),
    ]) await expect(f.pool.executeSessionAction(a.action, signature)).to.be.revertedWithCustomError(f.pool, "InvalidSessionSignature");
  });

  it("enforces the per-bet cap and total budget without blocking Hit on an already paid hand", async function () {
    const f = await reachPlayerTurn();
    const s = await authorize(f, { budget: TEST_BET.toString() });
    let a = await signedAction(f, s, 0, TEST_BET + 1n);
    await expect(f.pool.executeSessionAction(a.action, a.signature)).to.be.revertedWithCustomError(f.pool, "SessionBudgetExceeded");
    a = await signedAction(f, s);
    await f.pool.executeSessionAction(a.action, a.signature);
    expect((await f.pool.getSession(s.id)).remainingBudget).to.equal(0n);
    a = await signedAction(f, s);
    await expect(f.pool.executeSessionAction(a.action, a.signature)).to.be.revertedWithCustomError(f.pool, "SessionBudgetExceeded");
    // The same owner's older hand can be resumed after renewing a session.
    a = await signedAction(f, s, 1, 0n);
    await f.pool.executeSessionAction(a.action, a.signature);
    expect((await f.pool.getGameCore(0n)).state).to.equal(1n);
    expect((await f.pool.getSession(s.id)).remainingBudget).to.equal(0n);
  });

  it("rolls back the budget and nonce if the game action reverts", async function () {
    const f = await createPool(); const s = await authorize(f);
    await f.token.connect(f.player).approve(f.pool.target, 0n);
    const a = await signedAction(f, s);
    await expect(f.pool.executeSessionAction(a.action, a.signature)).to.be.revertedWithCustomError(f.pool, "InsufficientTokenAllowance");
    const state = await f.pool.getSession(s.id);
    expect(state.actionNonce).to.equal(0n);
    expect(state.remainingBudget).to.equal(ethers.parseEther("100"));
  });

  it("cannot play another user's game or authorize arbitrary operations", async function () {
    const f = await reachPlayerTurn();
    const key = Wallet.createRandom();
    const grant = { player: f.otherPlayer.address, sessionKey: key.address, nonce: "0", validUntil: String(await networkHelpers.time.latest() + 600), maxBet: TEST_BET.toString(), budget: TEST_BET.toString(), deploymentId: await f.pool.sessionDeploymentId() };
    const domain = sessionDomain(f.chainId, String(f.pool.target));
    await f.pool.registerSession(grant, await f.otherPlayer.signTypedData(domain, grantTypes, grant));
    const id = TypedDataEncoder.hash(domain, grantTypes, grant);
    for (const kind of [1, 2, 3, 255]) {
      const action = { sessionId: id, nonce: "0", kind, argument: "0", validUntil: String(await networkHelpers.time.latest() + 45) };
      const signature = await key.signTypedData(domain, actionTypes, action);
      await expect(f.pool.executeSessionAction(action, signature)).to.be.revertedWithCustomError(f.pool, kind < 3 ? "NotGamePlayer" : "InvalidSessionAction");
    }
  });

  it("replaces the prior session, permits owner revocation, and retains direct gameplay", async function () {
    const f = await reachPlayerTurn(); const first = await authorize(f); const oldAction = await signedAction(f, first, 2, 0n);
    const second = await authorize(f);
    await expect(f.pool.executeSessionAction(oldAction.action, oldAction.signature)).to.be.revertedWithCustomError(f.pool, "InvalidSession");
    await expect(f.pool.connect(f.outsider).revokeSession(second.id)).to.be.revertedWithCustomError(f.pool, "InvalidSession");
    await f.pool.connect(f.player).revokeSession(second.id);
    const a = await signedAction(f, second, 2, 0n);
    await expect(f.pool.executeSessionAction(a.action, a.signature)).to.be.revertedWithCustomError(f.pool, "InvalidSession");
    await f.pool.connect(f.player).stand(0n);
  });

  it("expires sessions and short-lived actions and bounds grants to 30 minutes", async function () {
    const f = await createPool(); const s = await authorize(f); const a = await signedAction(f, s);
    await networkHelpers.time.increase(46);
    await expect(f.pool.executeSessionAction(a.action, a.signature)).to.be.revertedWithCustomError(f.pool, "SessionExpired");
    await networkHelpers.time.increaseTo(BigInt(s.grant.validUntil));
    const expired = await signedAction(f, s);
    await expect(f.pool.executeSessionAction(expired.action, expired.signature)).to.be.revertedWithCustomError(f.pool, "SessionExpired");
    const grant = { ...s.grant, nonce: "1", validUntil: String(await networkHelpers.time.latest() + 1900) };
    await expect(f.pool.registerSession(grant, await f.player.signTypedData(s.domain, grantTypes, grant))).to.be.revertedWithCustomError(f.pool, "SessionExpired");
  });

  it("supports an ERC-1271 player without giving the relayer control of the account", async function () {
    const f = await createPool();
    const account = await ethers.deployContract("SessionTestAccount", [f.player.address]);
    await f.token.mint(account.target, TEST_BET);
    await account.connect(f.player).approveToken(f.token.target, f.pool.target, TEST_BET);
    const s = await authorize(f, { player: String(account.target), budget: TEST_BET.toString() });
    const a = await signedAction(f, s);
    await f.pool.connect(f.outsider).executeSessionAction(a.action, a.signature);
    expect((await f.pool.getGameCore(0n)).player).to.equal(account.target);
  });
});
