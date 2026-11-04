// Password and PIN hashing with scrypt (built into Node, no extra package). A stored hash looks like
//   scrypt:<log2 N>:<r>:<p>:<salt>:<hash>      (salt and hash in base64url; no dollar signs, so a shell or a .env file cannot mangle it)
// so the cost can be raised later without breaking old hashes. Comparison is constant-time.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEYLEN = 32;
export const DEFAULT_LOG_N = 15; // N = 32768, about 80 ms on a small server: slow enough to hurt a guesser, fast enough for a login

export interface ScryptParams { logN: number; r: number; p: number; salt: Buffer; hash: Buffer }

const b64 = (b: Buffer) => b.toString("base64url");

export function parseHash(stored: string | undefined | null): ScryptParams | null {
  if (!stored) return null;
  const parts = stored.trim().split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const logN = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(logN) || logN < 10 || logN > 18 || !Number.isInteger(r) || r < 1 || r > 16 || !Number.isInteger(p) || p < 1 || p > 4) return null;
  const salt = Buffer.from(parts[4], "base64url");
  const hash = Buffer.from(parts[5], "base64url");
  if (salt.length < 16 || hash.length < 16) return null;
  return { logN, r, p, salt, hash };
}

function derive(password: string, salt: Buffer, logN: number, r: number, p: number, len: number): Promise<Buffer> {
  const N = 2 ** logN;
  return new Promise((resolve, reject) => {
    scrypt(Buffer.from(password.normalize("NFKC"), "utf8"), salt, len, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string, logN = DEFAULT_LOG_N): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, logN, 8, 1, KEYLEN);
  return ["scrypt", logN, 8, 1, b64(salt), b64(hash)].join(":");
}

/** True only when the password matches the stored hash. Never throws: a broken hash simply never matches. */
export async function verifyPassword(password: string, stored: string | undefined | null): Promise<boolean> {
  const p = parseHash(stored);
  if (!p) return false;
  try {
    const got = await derive(password, p.salt, p.logN, p.r, p.p, p.hash.length);
    return got.length === p.hash.length && timingSafeEqual(got, p.hash);
  } catch {
    return false;
  }
}
