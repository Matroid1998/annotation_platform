import { createHash, randomBytes } from "node:crypto";
import { ApiError, object, string, validId } from "./validation";
import { hashPassword, verifyPassword, PasswordValidationError } from "./password";
export { hashPassword, validatePassword } from "./password";

export type AuthDatabase = Pick<D1Database, "prepare" | "batch">;
export type LocalRole = "admin" | "annotator";
export type AuthActor = { id: string; name: string; email: string; isAdmin: boolean; mustChangePassword: boolean };
type AccountRow = { id: string; email: string; name: string; password_hash: string; role: LocalRole; active: number; must_change_password: number; created_at: string; updated_at: string };
export type PublicAccount = { id: string; email: string; name: string; role: LocalRole; active: boolean; mustChangePassword: boolean; createdAt: string; updatedAt: string };
export type AuthResult = { actor: AuthActor; token: string; expiresAt: string };
export const SESSION_COOKIE = "annotation_session";
export const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 8;
const CLIENT_LIMIT = 60;

export class AuthError extends ApiError {
  constructor(status: number, message: string, public code?: string, public retryAfter?: number) { super(status, message); }
}
export function normalizeEmail(value: unknown): string {
  const email = string(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Enter a valid email address.");
  return email;
}
function digest(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }
function tokenHash(token: string | null): string | null { return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? digest(token) : null; }
function safeAccount(row: AccountRow): PublicAccount {
  return { id: row.id, email: row.email, name: row.name, role: row.role, active: row.active === 1, mustChangePassword: row.must_change_password === 1, createdAt: row.created_at, updatedAt: row.updated_at };
}
function safeActor(row: AccountRow): AuthActor { return { id: row.id, email: row.email, name: row.name, isAdmin: row.role === "admin", mustChangePassword: row.must_change_password === 1 }; }
function invalidCredentials(): never { throw new AuthError(401, "Email or password is incorrect.", "INVALID_CREDENTIALS"); }
async function checkedHash(password: unknown) {
  try { return await hashPassword(password); }
  catch (error) { if (error instanceof PasswordValidationError) throw new ApiError(400, error.message); throw error; }
}

export function readSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const matches = cookieHeader.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(SESSION_COOKIE.length + 1);
  return tokenHash(token) ? token : null;
}
export function sessionCookie(token: string, requestUrl: string, expiresAt: string): string {
  if (!tokenHash(token)) throw new Error("Invalid internal session token");
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}
export function clearSessionCookie(requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}
export function authResponse(result: AuthResult) {
  const { isAdmin, mustChangePassword, ...user } = result.actor;
  return { user, isAdmin, mustChangePassword };
}
export function assertExpectedActor(expected: string | null, current: { id: string }) {
  if (expected && expected !== current.id) throw new AuthError(409, "Account changed. Sign in again as the annotator who started this review before continuing.", "SESSION_ACCOUNT_MISMATCH");
}

export class AuthService {
  constructor(private db: AuthDatabase, private now: () => number = Date.now) {}
  private timestamp() { return new Date(this.now()).toISOString(); }
  async configured(): Promise<boolean> {
    return !!await this.db.prepare("SELECT 1 FROM local_accounts WHERE role = 'admin' AND active = 1 LIMIT 1").first();
  }
  private async sessionAccount(token: string | null): Promise<AccountRow | null> {
    const hash = tokenHash(token);
    if (!hash) return null;
    return this.db.prepare("SELECT a.* FROM auth_sessions s JOIN local_accounts a ON a.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND a.active = 1 AND a.role IN ('admin', 'annotator')")
      .bind(hash, this.timestamp()).first<AccountRow>();
  }
  async actor(token: string | null): Promise<AuthActor | null> {
    const account = await this.sessionAccount(token);
    return account ? safeActor(account) : null;
  }
  private async consumeRate(scope: string, limit: number): Promise<string> {
    const hash = digest(scope);
    const now = this.now();
    const before = now - RATE_WINDOW_MS;
    const counter = await this.db.prepare(`INSERT INTO auth_rate_limits (scope_hash, attempts, window_started_at) VALUES (?, 1, ?)
      ON CONFLICT(scope_hash) DO UPDATE SET attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END,
      window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END
      RETURNING attempts, window_started_at`).bind(hash, now, before, before).first<{ attempts: number; window_started_at: number }>();
    if (!counter) throw new ApiError(503, "Sign in is temporarily unavailable. Please try again.");
    if (counter.attempts > limit) {
      const retry = Math.max(1, Math.ceil((counter.window_started_at + RATE_WINDOW_MS - now) / 1000));
      throw new AuthError(429, "Too many sign-in attempts. Try again in 15 minutes.", "RATE_LIMITED", retry);
    }
    return hash;
  }
  async login(body: unknown, clientKey = "local-browser"): Promise<AuthResult> {
    const input = object(body);
    let email: string;
    try { email = normalizeEmail(input.email); } catch { email = "invalid-email"; }
    // Reserve attempts before hashing, so concurrent requests cannot bypass the
    // durable account limit. The local listener also has a shared client limit.
    await this.consumeRate(`login-client:${clientKey}`, CLIENT_LIMIT);
    const accountLimit = await this.consumeRate(`login-email:${email}`, LOGIN_LIMIT);
    const account = await this.db.prepare("SELECT * FROM local_accounts WHERE email = ?").bind(email).first<AccountRow>();
    const matches = await verifyPassword(input.password, account?.password_hash ?? null);
    if (!matches || !account || account.active !== 1 || !["admin", "annotator"].includes(account.role)) invalidCredentials();
    const token = randomBytes(32).toString("base64url");
    const now = this.timestamp();
    const expiresAt = new Date(this.now() + SESSION_LIFETIME_SECONDS * 1000).toISOString();
    // Recheck password/account state at the INSERT: a password reset or account
    // suspension during the slow hash must not mint a stale authenticated session.
    const inserted = await this.db.prepare("INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) SELECT ?, id, ?, ? FROM local_accounts WHERE id = ? AND password_hash = ? AND role = ? AND active = 1")
      .bind(digest(token), now, expiresAt, account.id, account.password_hash, account.role).run();
    if (!inserted.meta.changes) invalidCredentials();
    await this.db.prepare("DELETE FROM auth_rate_limits WHERE scope_hash = ?").bind(accountLimit).run();
    const confirmed = await this.sessionAccount(token);
    if (!confirmed) invalidCredentials();
    return { actor: safeActor(confirmed), token, expiresAt };
  }
  async logout(token: string | null): Promise<void> {
    const hash = tokenHash(token);
    if (hash) await this.db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(hash).run();
  }
  async changePassword(token: string | null, body: unknown): Promise<AuthResult> {
    const account = await this.sessionAccount(token);
    if (!account) throw new AuthError(401, "Sign in to change your password.", "UNAUTHENTICATED");
    const input = object(body);
    const rateHash = await this.consumeRate(`password-change:${account.id}`, LOGIN_LIMIT);
    if (!await verifyPassword(input.currentPassword, account.password_hash)) invalidCredentials();
    if (input.currentPassword === input.newPassword) throw new ApiError(400, "Choose a different password from your current password.");
    const passwordHash = await checkedHash(input.newPassword);
    const nextToken = randomBytes(32).toString("base64url");
    const now = this.timestamp();
    const expiresAt = new Date(this.now() + SESSION_LIFETIME_SECONDS * 1000).toISOString();
    const result = await this.db.batch([
      this.db.prepare("UPDATE local_accounts SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ? AND password_hash = ? AND active = 1 AND EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash = ? AND user_id = local_accounts.id AND expires_at > ?)").bind(passwordHash, now, account.id, account.password_hash, tokenHash(token), now),
      this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM local_accounts WHERE id = ? AND password_hash = ? AND active = 1)").bind(account.id, account.id, passwordHash),
      this.db.prepare("INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) SELECT ?, id, ?, ? FROM local_accounts WHERE id = ? AND password_hash = ? AND active = 1").bind(digest(nextToken), now, expiresAt, account.id, passwordHash),
      this.db.prepare("DELETE FROM auth_rate_limits WHERE scope_hash = ? AND EXISTS (SELECT 1 FROM local_accounts WHERE id = ? AND password_hash = ?)").bind(rateHash, account.id, passwordHash),
    ]);
    if (!result[0].meta.changes || !result[2].meta.changes) throw new AuthError(409, "Your account changed while this request was running. Sign in again.", "ACCOUNT_CHANGED");
    const confirmed = await this.sessionAccount(nextToken);
    if (!confirmed) throw new AuthError(401, "Sign in again to continue.", "UNAUTHENTICATED");
    return { actor: safeActor(confirmed), token: nextToken, expiresAt };
  }
  async createAccount(input: { id?: string; name: unknown; email: unknown; password: unknown; role: LocalRole; mustChangePassword?: boolean }, extraStatements: D1PreparedStatement[] = []): Promise<PublicAccount> {
    const id = input.id === undefined ? crypto.randomUUID() : validId(input.id, "Account ID");
    const email = normalizeEmail(input.email);
    const name = string(input.name, "Name", 120);
    if (input.role !== "admin" && input.role !== "annotator") throw new ApiError(400, "Choose a valid account role.");
    const passwordHash = await checkedHash(input.password);
    const now = this.timestamp();
    try {
      await this.db.batch([
        this.db.prepare("INSERT INTO local_accounts (id, email, name, password_hash, role, active, must_change_password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)").bind(id, email, name, passwordHash, input.role, input.mustChangePassword === false ? 0 : 1, now, now),
        ...extraStatements,
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE constraint")) throw new ApiError(409, "That email, account, or project assignment already exists. No changes were made.");
      throw error;
    }
    const row = await this.db.prepare("SELECT * FROM local_accounts WHERE id = ?").bind(id).first<AccountRow>();
    if (!row) throw new ApiError(503, "The account was created but confirmation is unavailable. Refresh the accounts list before retrying.");
    return safeAccount(row);
  }
  async resetPassword(userId: string, password: unknown, options: { mustChangePassword?: boolean } = {}): Promise<void> {
    const account = await this.db.prepare("SELECT * FROM local_accounts WHERE id = ?").bind(userId).first<AccountRow>();
    if (!account) throw new ApiError(404, "Account not found.");
    const passwordHash = await checkedHash(password);
    await this.db.batch([
      this.db.prepare("UPDATE local_accounts SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?").bind(passwordHash, options.mustChangePassword === false ? 0 : 1, this.timestamp(), userId),
      this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId),
      this.db.prepare("DELETE FROM auth_rate_limits WHERE scope_hash IN (?, ?)").bind(digest(`login-email:${account.email}`), digest(`password-change:${userId}`)),
    ]);
  }
  async setActive(userId: string, active: boolean): Promise<void> {
    if (typeof active !== "boolean") throw new ApiError(400, "Choose an account status.");
    const statements = [this.db.prepare("UPDATE local_accounts SET active = ?, updated_at = ? WHERE id = ?").bind(active ? 1 : 0, this.timestamp(), userId)];
    if (!active) statements.push(this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").bind(userId));
    const results = await this.db.batch(statements);
    if (!results[0].meta.changes) throw new ApiError(404, "Account not found.");
  }
}
