import { DatabaseSync } from "node:sqlite";
import type { Operation } from "../../shared/sessions.js";

export type Job = Operation & {
  slot: string; payload: string; data: string; target: string; created: number;
  raw: string | null; nonce: number | null; cost: string;
};

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string, readonly scope: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, slot TEXT NOT NULL,
        payload TEXT NOT NULL, data TEXT NOT NULL, target TEXT NOT NULL, status TEXT NOT NULL,
        created INTEGER NOT NULL, raw TEXT, txHash TEXT, nonce INTEGER,
        cost TEXT NOT NULL DEFAULT '0', error TEXT, sessionId TEXT, gameId TEXT);
      CREATE INDEX IF NOT EXISTS operations_scope ON operations(scope, status);
      CREATE TABLE IF NOT EXISTS games (scope TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  }
  get(id: string): Job | undefined {
    return this.db.prepare("SELECT * FROM operations WHERE id=? AND scope=?").get(id, this.scope) as Job | undefined;
  }
  active(slot: string): Job | undefined {
    return this.db.prepare("SELECT * FROM operations WHERE scope=? AND slot=? AND status IN ('queued','submitted')").get(this.scope, slot) as Job | undefined;
  }
  insert(id: string, slot: string, payload: string, data: string, target: string): Job {
    this.db.prepare("INSERT INTO operations (id,scope,slot,payload,data,target,status,created) VALUES (?,?,?,?,?,?,'queued',?)").run(id, this.scope, slot, payload, data, target, Date.now());
    return this.get(id)!;
  }
  update(id: string, changes: Partial<Job>) {
    const keys = Object.keys(changes);
    if (keys.some((key) => !["status", "raw", "txHash", "nonce", "cost", "error", "sessionId", "gameId"].includes(key))) throw new Error("Invalid operation update");
    this.db.prepare(`UPDATE operations SET ${keys.map((key) => `${key}=?`).join(",")} WHERE id=? AND scope=?`).run(
      ...keys.map((key) => changes[key as keyof Job] ?? null), id, this.scope,
    );
  }
  pending(): Job[] {
    return this.db.prepare("SELECT * FROM operations WHERE scope=? AND status IN ('queued','submitted') ORDER BY CASE status WHEN 'submitted' THEN 0 ELSE 1 END, created, rowid").all(this.scope) as Job[];
  }
  committedCost(): bigint {
    const start = new Date().setUTCHours(0, 0, 0, 0);
    const rows = this.db.prepare("SELECT cost FROM operations WHERE scope=? AND (status='submitted' OR (status IN ('confirmed','failed') AND created>=?))").all(this.scope, start) as { cost: string }[];
    return rows.reduce((sum, row) => sum + BigInt(row.cost), 0n);
  }
  track(gameId: string) {
    this.db.prepare("INSERT OR IGNORE INTO games VALUES (?,?)").run(this.scope, gameId);
  }
  finish(gameId: string) {
    this.db.prepare("DELETE FROM games WHERE scope=? AND id=?").run(this.scope, gameId);
  }
  games(): string[] {
    return (this.db.prepare("SELECT id FROM games WHERE scope=?").all(this.scope) as { id: string }[]).map((row) => row.id);
  }
  metadata(key: string): string | undefined {
    return (this.db.prepare("SELECT value FROM metadata WHERE key=?").get(`${this.scope}:${key}`) as { value: string } | undefined)?.value;
  }
  setMetadata(key: string, value: string) {
    this.db.prepare("INSERT OR REPLACE INTO metadata VALUES (?,?)").run(`${this.scope}:${key}`, value);
  }
  close() { this.db.close(); }
}
