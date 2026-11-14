import { BaseWallet, Contract, SigningKey, TypedDataEncoder, hexlify, randomBytes } from "ethers";
import type { BrowserProvider, Signer } from "ethers";
import { fairJackPoolAbi } from "../contracts/abis.js";
import { actionTypes, grantTypes, sessionDomain } from "../../../shared/sessions.js";
import type { Operation, SessionAction, SessionGrant } from "../../../shared/sessions.js";

export type RelayConfig = { chainId: string; pool: string; deploymentId: string; maxSessionBudget: string; maxDuration: number; dealer: boolean; available: boolean; unavailable: string | null };
type LocalSession = { id: string; key: BaseWallet; validUntil: number; remaining: bigint; maxBet: bigint };

export class SessionClient {
  session: LocalSession | null = null;
  pending: Operation | null = null;
  private finalize: ((operation: Operation) => void) | null = null;
  readonly pool: Contract;
  readonly provider: BrowserProvider;
  readonly signer: Pick<Signer, "signTypedData">;
  readonly account: string;
  readonly chainId: bigint;
  readonly poolAddress: string;
  readonly progress: (message: string) => void;
  readonly request: typeof fetch;
  readonly pollIntervalMs: number;
  secondsLeft = 0;
  constructor(
    provider: BrowserProvider, signer: Pick<Signer, "signTypedData">,
    account: string, chainId: bigint, poolAddress: string,
    progress: (message: string) => void = () => {},
    request: typeof fetch = (input, init) => globalThis.fetch(input, init),
    pollIntervalMs = 1000,
  ) {
    this.provider = provider; this.signer = signer; this.account = account;
    this.chainId = chainId; this.poolAddress = poolAddress;
    this.progress = progress; this.request = request;
    this.pollIntervalMs = pollIntervalMs;
    this.pool = new Contract(poolAddress, fairJackPoolAbi, provider);
  }

  private async api<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.request(`/api/${path}`, {
      ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw Object.assign(new Error(result.error || "Relayer non disponibile."), { definitive: response.status < 500 });
    return result as T;
  }
  async config(): Promise<RelayConfig> {
    const config = await this.api<RelayConfig>("config");
    if (BigInt(config.chainId) !== this.chainId || config.pool.toLowerCase() !== this.poolAddress.toLowerCase()) throw new Error("Il relayer usa una rete o un deploy diverso dal frontend.");
    if (config.deploymentId !== await this.pool.sessionDeploymentId()) throw new Error("Configurazione del relayer obsoleta: riavvialo dopo il deploy.");
    return config;
  }
  private async now() {
    // Pending blocks can have a null block number. Read only the timestamp
    // instead of passing that response through ethers' mined-block formatter.
    const block = await this.provider.send("eth_getBlockByNumber", ["pending", false]) as { timestamp: string } | null;
    if (!block) throw new Error("Blocco non disponibile.");
    return Number(BigInt(block.timestamp));
  }
  async refresh() {
    if (!this.session) { this.secondsLeft = 0; return; }
    const state = await this.pool.getSession(this.session.id);
    this.session.remaining = state.remainingBudget;
    this.session.maxBet = state.maxBet;
    this.secondsLeft = Math.max(0, this.session.validUntil - await this.now());
    if (state.revoked || await this.pool.activeSession(this.account) !== this.session.id || this.secondsLeft === 0) {
      this.session = null;
    }
  }
  forgetSession() {
    this.session = null;
    this.secondsLeft = 0;
  }
  async register(budget: bigint, maxBet: bigint) {
    if (this.pending) throw new Error("Verifica prima l’operazione già inviata.");
    const config = await this.config();
    if (!config.available) throw new Error(config.unavailable || "Sponsorizzazione non disponibile.");
    if (budget > BigInt(config.maxSessionBudget)) throw new Error("Budget oltre il limite sponsorizzato.");
    const key = new BaseWallet(new SigningKey(hexlify(randomBytes(32)))); // Memory only. Never serialize this wallet.
    const grant: SessionGrant = {
      player: this.account, sessionKey: key.address,
      nonce: (await this.pool.sessionNonces(this.account)).toString(),
      validUntil: String(await this.now() + 1800), maxBet: maxBet.toString(), budget: budget.toString(), deploymentId: config.deploymentId,
    };
    this.progress("Firma l’autorizzazione della sessione nel wallet.");
    const domain = sessionDomain(this.chainId, this.poolAddress);
    const signature = await this.signer.signTypedData(domain, grantTypes, grant);
    const id = TypedDataEncoder.hash(domain, grantTypes, grant);
    this.finalize = () => { this.session = { id, key, validUntil: Number(grant.validUntil), remaining: budget, maxBet }; };
    // Keep the signed request if the POST response is lost. Repeating this exact
    // request is idempotent, unlike creating a fresh authorization or wager.
    return this.submit("sessions", { grant, signature });
  }
  async send(kind: number, argument: bigint) {
    if (this.pending) throw new Error("Verifica prima l’operazione già inviata.");
    await this.refresh();
    const session = this.session;
    if (!session) throw new Error("Apri o rinnova la sessione di gioco.");
    if (kind === 0 && (argument > session.remaining || argument > session.maxBet)) throw new Error("Puntata oltre il budget o il limite della sessione.");
    const config = await this.config();
    if (!config.available) throw new Error(config.unavailable || "Relayer non disponibile.");
    const state = await this.pool.getSession(session.id);
    const action: SessionAction = {
      sessionId: session.id, nonce: state.actionNonce.toString(), kind, argument: argument.toString(),
      validUntil: String(Math.min(await this.now() + 45, session.validUntil)),
    };
    const signature = await session.key.signTypedData(sessionDomain(this.chainId, this.poolAddress), actionTypes, action);
    this.finalize = null;
    return this.submit("actions", { action, signature });
  }
  private retryPost: { path: string; body: unknown } | null = null;
  private async submit(path: string, body: unknown) {
    this.retryPost = { path, body };
    // A placeholder prevents a lost POST response from enabling a second move.
    this.pending = { id: "", status: "queued" };
    try {
      this.pending = await this.api<Operation>(path, body);
      this.retryPost = null;
    } catch (error) {
      // A definite HTTP rejection has no queued transaction; a lost response
      // must retain the exact request until its status has been reconciled.
      if (typeof error === "object" && error !== null && "definitive" in error && error.definitive) {
        this.pending = null; this.retryPost = null; this.finalize = null;
      }
      throw error;
    }
    return this.resume();
  }
  async resume(): Promise<Operation> {
    if (this.retryPost) {
      try {
        this.pending = await this.api<Operation>(this.retryPost.path, this.retryPost.body);
        this.retryPost = null;
      } catch (error) {
        if (typeof error === "object" && error !== null && "definitive" in error && error.definitive) {
          this.pending = null; this.retryPost = null; this.finalize = null;
        }
        throw error;
      }
    }
    if (!this.pending?.id) throw new Error("Nessuna operazione da verificare.");
    const id = this.pending.id;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const operation: Operation = await this.api<Operation>(`operations/${id}`);
      this.pending = operation;
      if (operation.status === "failed") {
        this.pending = null;
        this.finalize = null;
        throw new Error(operation.error || "Operazione fallita.");
      }
      if (operation.status === "confirmed") {
        this.finalize?.(operation);
        this.finalize = null;
        this.pending = null;
        await this.refresh();
        return operation;
      }
      this.progress(operation.status === "queued" ? "Invio tramite relayer…" : "Conferma sulla rete…");
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new Error("Operazione ancora in attesa. Usa “Verifica operazione” prima di inviare altre mosse.");
  }
}
