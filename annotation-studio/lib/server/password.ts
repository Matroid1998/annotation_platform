import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";

// OWASP's 32 MiB scrypt configuration; supported by the local Workerd runtime.
// https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
// https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLELISM = 3;
const KEY_BYTES = 64;
const MAX_MEMORY = 64 * 1024 * 1024;
let derivationQueue: Promise<void> = Promise.resolve();

export class PasswordValidationError extends Error {}

export function validatePassword(value: unknown): string {
  if (typeof value !== "string" || [...value].length < 12 || [...value].length > 128 || Buffer.byteLength(value, "utf8") > 1024) {
    throw new PasswordValidationError("Use a password between 12 and 128 characters. Passwords are never shortened or trimmed.");
  }
  return value;
}

function derive(password: string, salt: Uint8Array): Promise<Buffer> {
  // Keep at most one memory-hard operation active per worker isolate.
  const pending = derivationQueue.then(() => new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  }));
  derivationQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

export async function hashPassword(value: unknown): Promise<string> {
  const password = validatePassword(value);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString("hex")}$${key.toString("hex")}`;
}

const DUMMY_HASH = `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${"42".repeat(16)}$${"00".repeat(KEY_BYTES)}`;
export async function verifyPassword(value: unknown, hash: string | null): Promise<boolean> {
  if (typeof value !== "string" || [...value].length > 128 || Buffer.byteLength(value, "utf8") > 1024) return false;
  const stored = hash ?? DUMMY_HASH;
  const match = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(stored);
  if (!match) return false;
  const actual = await derive(value, Buffer.from(match[1], "hex"));
  const valid = timingSafeEqual(actual, Buffer.from(match[2], "hex"));
  return hash !== null && valid;
}
