// Every login try is written down (time, which kind of login was tried, success, a hashed address; never a password or PIN), and the
// lock-outs are worked out from that record. The record lives in the database table `login_attempts`; the same rows are also kept
// in memory on each server, so a database that is down, or a table that is missing, never switches the lock-outs off.
import { randomBytes } from "node:crypto";
import { pool } from "@/lib/db";
import type { Role } from "./session";

export interface Attempt {
  ref: string;
  at: number; // ms
  role: Role; // which login was tried (decided by the shape of what was typed)
  ok: boolean;
  blocked: boolean; // refused because of a lock-out (not counted again)
  ip: string; // hashed
  fid: string; // hashed id of the browser's cookie
}

export interface AttemptStore {
  /** Not-blocked failures of one kind since `sinceMs`. */
  failures(role: Role, sinceMs: number): Promise<Attempt[]>;
  record(a: Attempt): Promise<void>;
  recent(limit: number): Promise<Attempt[]>;
  /** "database" while the table answers, otherwise "memory" */
  kind(): "database" | "memory";
}

export const newRef = () => randomBytes(9).toString("base64url");

const MEM_KEEP_MS = 2 * 3600 * 1000;
const MEM_MAX = 2000;

export class MemoryStore implements AttemptStore {
  private rows: Attempt[] = [];
  async failures(role: Role, sinceMs: number) {
    return this.rows.filter((r) => r.role === role && !r.ok && !r.blocked && r.at > sinceMs);
  }
  async record(a: Attempt) {
    this.rows.push(a);
    const cut = a.at - MEM_KEEP_MS;
    this.rows = this.rows.filter((r) => r.at > cut).slice(-MEM_MAX);
  }
  async recent(limit: number) {
    return [...this.rows].sort((x, y) => y.at - x.at).slice(0, limit);
  }
  kind(): "database" | "memory" {
    return "memory";
  }
}

/** Database first, memory always. Reads merge both (same `ref` counted once); a database error only means the memory copy is used. */
export class ResilientStore implements AttemptStore {
  private mem = new MemoryStore();
  private dbOk = true;
  private warned = false;
  private fail(e: unknown) {
    this.dbOk = false;
    if (!this.warned) {
      this.warned = true;
      console.warn(`[login] login_attempts is not available (${e instanceof Error ? e.message : "error"}): lock-outs use in-memory counters on this server only.`);
    }
  }
  private merge(a: Attempt[], b: Attempt[]): Attempt[] {
    const seen = new Map<string, Attempt>();
    for (const x of [...a, ...b]) seen.set(x.ref, x);
    return [...seen.values()];
  }
  async failures(role: Role, sinceMs: number) {
    const mem = await this.mem.failures(role, sinceMs);
    try {
      const { rows } = await pool.query(
        `SELECT ref, (extract(epoch from attempted_at) * 1000)::float8 AS at, ip_hash, fid_hash FROM login_attempts
          WHERE role_tried = $1 AND ok = false AND blocked = false AND attempted_at > to_timestamp($2::float8 / 1000.0)`,
        [role, sinceMs]
      );
      this.dbOk = true;
      return this.merge(rows.map((r) => ({ ref: String(r.ref), at: Number(r.at), role, ok: false, blocked: false, ip: String(r.ip_hash), fid: String(r.fid_hash) })), mem);
    } catch (e) {
      this.fail(e);
      return mem;
    }
  }
  async record(a: Attempt) {
    await this.mem.record(a);
    try {
      await pool.query(`INSERT INTO login_attempts (ref, attempted_at, role_tried, ok, blocked, ip_hash, fid_hash) VALUES ($1, to_timestamp($2::float8 / 1000.0), $3, $4, $5, $6, $7)`, [a.ref, a.at, a.role, a.ok, a.blocked, a.ip, a.fid]);
      this.dbOk = true;
    } catch (e) {
      this.fail(e);
    }
  }
  async recent(limit: number) {
    const mem = await this.mem.recent(limit);
    try {
      const { rows } = await pool.query(
        `SELECT ref, (extract(epoch from attempted_at) * 1000)::float8 AS at, role_tried, ok, blocked, ip_hash, fid_hash FROM login_attempts ORDER BY attempted_at DESC LIMIT $1`,
        [limit]
      );
      this.dbOk = true;
      const db = rows.map((r) => ({ ref: String(r.ref), at: Number(r.at), role: (r.role_tried === "staff" ? "staff" : "owner") as Role, ok: Boolean(r.ok), blocked: Boolean(r.blocked), ip: String(r.ip_hash), fid: String(r.fid_hash) }));
      return this.merge(db, mem).sort((x, y) => y.at - x.at).slice(0, limit);
    } catch (e) {
      this.fail(e);
      return mem;
    }
  }
  kind(): "database" | "memory" {
    return this.dbOk ? "database" : "memory";
  }
}

declare global {
  var loginStore: AttemptStore | undefined;
}
export function getStore(): AttemptStore {
  if (!globalThis.loginStore) globalThis.loginStore = new ResilientStore();
  return globalThis.loginStore;
}

// ---- the lock-out rules -------------------------------------------------------------------------------------------------------

export const TRY_LIMIT = 5; // wrong tries ...
export const TRY_WINDOW_MS = 15 * 60 * 1000; // ... in 15 minutes, per address and per browser
export const PIN_FARM_LIMIT = 20; // wrong PINs from anywhere ...
export const PIN_FARM_WINDOW_MS = 60 * 60 * 1000; // ... in an hour pauses PIN login for an hour

export type LockState = { state: "ok" } | { state: "locked"; until: number } | { state: "paused"; until: number };

/**
 * When does the lock that `n` failures inside `windowMs` cause end? The lock starts at the failure that completes the set (the 5th, or
 * the 20th) and lasts one full window from then, so "wait 15 minutes" is true. Returns null when no set of `n` failures fits in the window.
 */
export function lockEnd(times: number[], n: number, windowMs: number): number | null {
  const t = [...times].sort((a, b) => a - b);
  let until: number | null = null;
  for (let i = n - 1; i < t.length; i++) if (t[i] - t[i - n + 1] < windowMs) until = Math.max(until ?? 0, t[i] + windowMs);
  return until;
}

/** Owner-password tries and PIN tries are counted separately, so guessing the PIN can never lock the owner out. */
export async function lockState(store: AttemptStore, role: Role, ip: string, fid: string, now: number): Promise<LockState> {
  const span = Math.max(2 * TRY_WINDOW_MS, role === "staff" ? 2 * PIN_FARM_WINDOW_MS : 0);
  const recent = await store.failures(role, now - span);
  if (role === "staff") {
    const until = lockEnd(recent.map((r) => r.at), PIN_FARM_LIMIT, PIN_FARM_WINDOW_MS);
    if (until !== null && until > now) return { state: "paused", until };
  }
  for (const mine of [recent.filter((r) => r.ip === ip), recent.filter((r) => r.fid === fid)]) {
    const until = lockEnd(mine.map((r) => r.at), TRY_LIMIT, TRY_WINDOW_MS);
    if (until !== null && until > now) return { state: "locked", until };
  }
  return { state: "ok" };
}
