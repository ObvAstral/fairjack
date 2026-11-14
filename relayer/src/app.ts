import Fastify from "fastify";
import { TypedDataEncoder, verifyTypedData } from "ethers";
import { actionTypes, grantTypes, sessionDomain } from "../../shared/sessions.js";
import type { Operation, SessionAction, SessionGrant } from "../../shared/sessions.js";
import { readableError } from "../../frontend/src/utils/errors.js";
import type { Job } from "./store.js";
import { RelayEngine } from "./engine.js";

const uint = { type: "string", pattern: "^(0|[1-9][0-9]{0,77})$" };
const address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
const hash = { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" };
const signature = { type: "string", pattern: "^0x([0-9a-fA-F]{2})+$", maxLength: 16386 };
const grantProperties = { player: address, sessionKey: address, nonce: uint, validUntil: uint, maxBet: uint, budget: uint, deploymentId: hash };
const actionProperties = { sessionId: hash, nonce: uint, kind: { type: "integer", minimum: 0, maximum: 2 }, argument: uint, validUntil: uint };
function bodySchema(name: string, properties: Record<string, unknown>) {
  return { body: { type: "object", additionalProperties: false, required: [name, "signature"], properties: {
    [name]: { type: "object", additionalProperties: false, required: Object.keys(properties), properties }, signature,
  } } };
}
export function publicOperation(row: Job): Operation {
  return { id: row.id, status: row.status, ...(row.txHash ? { txHash: row.txHash } : {}),
    ...(row.error ? { error: row.error } : {}), ...(row.sessionId ? { sessionId: row.sessionId } : {}), ...(row.gameId ? { gameId: row.gameId } : {}) };
}

export function createApp(engine: RelayEngine, allowedOrigin = "http://localhost:5173", trustProxy: string[] | false = false) {
  const app = Fastify({ trustProxy, bodyLimit: 24_576, ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  const buckets = new Map<string, { count: number; until: number }>();
  function rateLimit(key: string, limit: number) {
    const now = Date.now();
    // Bound memory even if clients use many different addresses / IPs.
    if (buckets.size > 10_000) for (const [id, bucket] of buckets) if (bucket.until < now) buckets.delete(id);
    const bucket = buckets.get(key);
    if (bucket && bucket.until >= now) {
      if (++bucket.count > limit) throw Object.assign(new Error("Troppe richieste: riprova tra un minuto."), { statusCode: 429 });
    } else {
      if (buckets.size >= 20_000) throw Object.assign(new Error("Servizio occupato."), { statusCode: 429 });
      buckets.set(key, { count: 1, until: now + 60_000 });
    }
  }
  app.addHook("onRequest", async (request) => {
    if (request.method === "POST") {
      if (request.headers.origin && request.headers.origin !== allowedOrigin)
        throw Object.assign(new Error("Origine non consentita."), { statusCode: 403 });
      rateLimit(`ip:${request.ip}`, 60);
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    const statusCode = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 400;
    reply.code(statusCode >= 400 && statusCode < 600 ? statusCode : 400).send({ error: readableError(error) });
  });
  app.get("/api/config", async () => {
    let unavailable: string | null = null;
    try {
      await engine.checkChain();
      if (engine.store.committedCost() >= engine.limits.dailyBudget) throw new Error("Budget giornaliero del relayer esaurito.");
      const balance = await engine.provider.getBalance(engine.wallet.address);
      const fees = await engine.provider.getFeeData();
      if (engine.store.committedCost() + engine.limits.gasPerTx * (fees.maxFeePerGas ?? fees.gasPrice ?? 0n) > engine.limits.dailyBudget) throw new Error("Budget giornaliero del relayer esaurito.");
      if (balance < engine.limits.gasPerTx * (fees.maxFeePerGas ?? fees.gasPrice ?? 0n)) throw new Error("Saldo ETH del relayer insufficiente.");
      if ((fees.maxFeePerGas ?? fees.gasPrice ?? 0n) > engine.limits.feePerGas) throw new Error("Prezzo del gas oltre il limite di sponsorizzazione.");
    } catch (error) { unavailable = readableError(error); }
    return { chainId: engine.chainId.toString(), pool: engine.poolAddress, deploymentId: engine.deploymentId,
      maxSessionBudget: engine.limits.maxSessionBudget.toString(), maxDuration: 1800, dealer: true,
      available: unavailable === null, unavailable };
  });
  app.get<{ Params: { id: string } }>("/api/operations/:id", async (request, reply) => {
    const row = engine.store.get(request.params.id);
    return row ? publicOperation(row) : reply.code(404).send({ error: "Operazione non trovata." });
  });
  const domain = sessionDomain(engine.chainId, engine.poolAddress);
  app.post<{ Body: { grant: SessionGrant; signature: string } }>("/api/sessions", { schema: bodySchema("grant", grantProperties) }, async (request) => {
    const { grant, signature: signed } = request.body;
    rateLimit(`account:${grant.player.toLowerCase()}`, 30);
    const id = TypedDataEncoder.hash(domain, grantTypes, grant);
    const existing = engine.store.get(id);
    if (existing) return publicOperation(existing);
    if (BigInt(grant.budget) > engine.limits.maxSessionBudget) throw new Error("Budget della sessione oltre il limite sponsorizzato.");
    const data = engine.pool.interface.encodeFunctionData("registerSession", [grant, signed]);
    return publicOperation(await engine.enqueue(data, JSON.stringify(grant), `grant:${grant.player.toLowerCase()}:${grant.nonce}`, id));
  });
  app.post<{ Body: { action: SessionAction; signature: string } }>("/api/actions", { schema: bodySchema("action", actionProperties) }, async (request) => {
    const { action, signature: signed } = request.body;
    const id = TypedDataEncoder.hash(domain, actionTypes, action);
    const session = await engine.pool.getSession(action.sessionId);
    rateLimit(`account:${String(session.player).toLowerCase()}`, 30);
    if (verifyTypedData(domain, actionTypes, action, signed).toLowerCase() !== String(session.sessionKey).toLowerCase()) throw new Error("Firma della mossa non valida.");
    const data = engine.pool.interface.encodeFunctionData("executeSessionAction", [action, signed]);
    return publicOperation(await engine.enqueue(data, JSON.stringify(action), `action:${action.sessionId}:${action.nonce}`, id));
  });
  return app;
}
