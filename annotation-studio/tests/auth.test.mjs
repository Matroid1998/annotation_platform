import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const work = await mkdtemp(join(tmpdir(), 'annotation-auth-'));
await build({ entryPoints: [new URL('../lib/server/auth.ts', import.meta.url).pathname], outfile: join(work, 'auth.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { AuthService, hashPassword, validatePassword, readSessionToken, sessionCookie, clearSessionCookie, authResponse, assertExpectedActor } = await import(pathToFileURL(join(work, 'auth.mjs')).href);
const migrations = (await readdir(new URL('../drizzle', import.meta.url))).filter((name) => name.endsWith('.sql')).sort();
const migrationSQL = await Promise.all(migrations.map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')));
const password = 'Initial account password 2026!';
const changedPassword = 'New individual password 2026!';
const resetPassword = 'Administrator reset password 2026!';
const initialHash = await hashPassword(password);

class TestDatabase {
  constructor(path = ':memory:', migrate = true) {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys = ON');
    if (migrate) for (const sql of migrationSQL) this.sqlite.exec(sql);
    this.batchQueue = Promise.resolve();
  }
  prepare(sql) {
    const db = this;
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() { return db.sqlite.prepare(sql).get(...this.args) ?? null; },
      async all() { return { results: db.sqlite.prepare(sql).all(...this.args), success: true, meta: {} }; },
      async run() {
        if (db.beforeSession && sql.startsWith('INSERT INTO auth_sessions')) { const callback = db.beforeSession; db.beforeSession = null; callback(); }
        if (db.failNextSession && sql.startsWith('INSERT INTO auth_sessions')) { db.failNextSession = false; throw Error('Injected session persistence failure'); }
        const result = db.sqlite.prepare(sql).run(...this.args);
        return { results: [], success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  async batch(statements) {
    const execute = async () => {
      this.sqlite.exec('BEGIN IMMEDIATE');
      try { const result = []; for (const stmt of statements) result.push(await stmt.run()); this.sqlite.exec('COMMIT'); return result; }
      catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
    };
    const pending = this.batchQueue.then(execute, execute);
    this.batchQueue = pending.catch(() => {});
    return pending;
  }
  close() { this.sqlite.close(); }
}
function fixture(path) {
  const db = new TestDatabase(path);
  const now = new Date('2026-11-10T10:00:00.000Z').getTime();
  const clock = { now };
  for (const [id, email, role] of [['alice', 'alice@example.test', 'annotator'], ['admin', 'admin@example.test', 'admin']]) {
    db.sqlite.prepare('INSERT INTO local_accounts (id,email,name,password_hash,role,active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,?,1,1,?,?)').run(id, email, id, initialHash, role, new Date(now).toISOString(), new Date(now).toISOString());
  }
  return { db, clock, auth: new AuthService(db, () => clock.now) };
}
function status(expected) { return (error) => error.status === expected; }
const signIn = (auth, email = 'alice@example.test', secret = password) => auth.login({ email, password: secret });
after(async () => { await rm(work, { recursive: true, force: true }); });

test('real local passwords create sessions with stable account roles and hashes never appear in responses', async () => {
  const { db, auth } = fixture();
  try {
    const result = await auth.login({ email: ' ALICE@EXAMPLE.TEST ', password, role: 'admin', isAdmin: true });
    assert.equal(result.actor.id, 'alice');
    assert.equal(result.actor.isAdmin, false);
    assert.equal(result.actor.mustChangePassword, true);
    assert.equal((await signIn(auth, 'admin@example.test')).actor.isAdmin, true);
    assert.equal(await auth.configured(), true);
    const stored = db.sqlite.prepare('SELECT * FROM auth_sessions WHERE user_id = ?').get('alice');
    assert.equal(stored.token_hash, createHash('sha256').update(result.token).digest('hex'));
    assert.notEqual(stored.token_hash, result.token);
    const publicData = JSON.stringify(authResponse(result));
    for (const secret of [password, initialHash, result.token, stored.token_hash]) assert.equal(publicData.includes(secret), false);
    assert.deepEqual(await auth.actor(result.token), result.actor);
  } finally { db.close(); }
});

test('wrong passwords, missing accounts, and disabled accounts return the same generic failure', async () => {
  const { db, auth } = fixture();
  try {
    const errors = [];
    for (const [email, secret] of [['alice@example.test', 'Incorrect password'], ['missing@example.test', password]]) {
      try { await signIn(auth, email, secret); assert.fail('Unexpected login success'); } catch (error) { errors.push(error); }
    }
    await auth.setActive('alice', false);
    try { await signIn(auth); assert.fail('Unexpected login success'); } catch (error) { errors.push(error); }
    assert.equal(errors.every((error) => error.status === 401 && error.message === 'Email or password is incorrect.'), true);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM auth_sessions').get().n, 0);
  } finally { db.close(); }
});

test('forged, missing, expired and logged-out session tokens cannot authenticate', async () => {
  const { db, auth, clock } = fixture();
  try {
    const result = await signIn(auth);
    assert.equal(await auth.actor(null), null);
    assert.equal(await auth.actor('local_seedy'), null);
    assert.equal(await auth.actor('A'.repeat(43)), null);
    clock.now += 12 * 60 * 60 * 1000;
    assert.equal(await auth.actor(result.token), null);
    const fresh = await signIn(auth);
    await auth.logout(fresh.token);
    assert.equal(await auth.actor(fresh.token), null);
    await auth.logout(fresh.token);
  } finally { db.close(); }
});

test('cookies are host-scoped HttpOnly SameSite and HTTPS cookies add Secure; ambiguous cookies are rejected', async () => {
  const { db, auth } = fixture();
  try {
    const result = await signIn(auth);
    const http = sessionCookie(result.token, 'http://localhost:5173/', result.expiresAt);
    const https = sessionCookie(result.token, 'https://annotation.example/', result.expiresAt);
    for (const cookie of [http, https]) {
      assert.ok(cookie.includes('HttpOnly')); assert.ok(cookie.includes('SameSite=Lax')); assert.ok(cookie.includes('Path=/')); assert.ok(cookie.includes('Max-Age=43200'));
      assert.equal(cookie.includes('Domain='), false);
    }
    assert.equal(http.includes('; Secure'), false);
    assert.equal(https.includes('; Secure'), true);
    assert.equal(readSessionToken(`unrelated=abc; annotation_session=${result.token}`), result.token);
    assert.equal(readSessionToken(`annotation_session=${result.token}; annotation_session=${result.token}`), null);
    assert.equal(readSessionToken('annotation_session=bad%0D%0Avalue'), null);
    assert.equal(readSessionToken('sites-dev-auth=local_seedy'), null);
    assert.ok(clearSessionCookie('https://annotation.example/').includes('Max-Age=0'));
    assert.ok(clearSessionCookie('https://annotation.example/').includes('; Secure'));
  } finally { db.close(); }
});

test('changing a temporary password rotates the session and invalidates every prior session atomically', async () => {
  const { db, auth } = fixture();
  try {
    const first = await signIn(auth), second = await signIn(auth);
    await assert.rejects(auth.changePassword(first.token, { currentPassword: 'incorrect', newPassword: changedPassword }), status(401));
    assert.ok(await auth.actor(first.token));
    const changed = await auth.changePassword(first.token, { currentPassword: password, newPassword: changedPassword });
    assert.notEqual(changed.token, first.token);
    assert.equal(changed.actor.id, 'alice');
    assert.equal(changed.actor.mustChangePassword, false);
    assert.equal(await auth.actor(first.token), null);
    assert.equal(await auth.actor(second.token), null);
    assert.equal((await auth.actor(changed.token)).mustChangePassword, false);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM auth_sessions WHERE user_id = ?').get('alice').n, 1);
    await assert.rejects(signIn(auth, 'alice@example.test', password), status(401));
    assert.equal((await signIn(auth, 'alice@example.test', changedPassword)).actor.id, 'alice');
  } finally { db.close(); }
});

test('failed session persistence rolls back the entire password change rather than locking out the account', async () => {
  const { db, auth } = fixture();
  try {
    const signedIn = await signIn(auth);
    db.failNextSession = true;
    await assert.rejects(auth.changePassword(signedIn.token, { currentPassword: password, newPassword: changedPassword }), /Injected session persistence failure/);
    assert.equal(db.sqlite.prepare('SELECT password_hash FROM local_accounts WHERE id = ?').get('alice').password_hash, initialHash);
    assert.ok(await auth.actor(signedIn.token));
    assert.equal((await signIn(auth)).actor.id, 'alice');
  } finally { db.close(); }
});

test('administrator reset and disabling revoke sessions while retaining account identity and annotation records', async () => {
  const { db, auth } = fixture();
  try {
    db.sqlite.prepare('INSERT INTO qualifications (project_id,user_id,version,passed_at) VALUES (?,?,?,?)').run('eurlex', 'alice', 'original', '2026-11-01T00:00:00Z');
    db.sqlite.prepare('INSERT INTO submissions (id,project_id,document_id,user_id,request_id,payload,qualification_version,saved_at) VALUES (?,?,?,?,?,?,?,?)').run('saved-annotation', 'eurlex', 'doc-1', 'alice', 'request-1', '{"ratings":[]}', 'original', '2026-11-01T01:00:00Z');
    const original = await signIn(auth);
    await auth.resetPassword('alice', resetPassword, { mustChangePassword: true });
    assert.equal(await auth.actor(original.token), null);
    await assert.rejects(signIn(auth, 'alice@example.test', password), status(401));
    const reset = await signIn(auth, 'alice@example.test', resetPassword);
    assert.equal(reset.actor.id, 'alice'); assert.equal(reset.actor.mustChangePassword, true);
    await auth.setActive('alice', false);
    assert.equal(await auth.actor(reset.token), null);
    await assert.rejects(signIn(auth, 'alice@example.test', resetPassword), status(401));
    await auth.setActive('alice', true);
    assert.equal(await auth.actor(reset.token), null);
    assert.equal((await signIn(auth, 'alice@example.test', resetPassword)).actor.id, 'alice');
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM qualifications WHERE user_id = ?').get('alice').n, 1);
    assert.equal(db.sqlite.prepare('SELECT id FROM submissions WHERE user_id = ?').get('alice').id, 'saved-annotation');
  } finally { db.close(); }
});

test('durable attempt limits survive fresh services and expire after their window', async () => {
  const { db, auth, clock } = fixture();
  try {
    for (let attempt = 0; attempt < 8; attempt++) await assert.rejects(signIn(auth, 'alice@example.test', 'bad password'), status(401));
    const reentered = new AuthService(db, () => clock.now);
    await assert.rejects(signIn(reentered), (error) => error.status === 429 && error.retryAfter === 900);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM auth_sessions').get().n, 0);
    clock.now += 15 * 60 * 1000;
    assert.equal((await signIn(reentered)).actor.id, 'alice');
  } finally { db.close(); }
});

test('password reset or suspension during verification cannot create a session using stale credentials', async () => {
  for (const action of ['reset', 'disable']) {
    const { db, auth } = fixture();
    try {
      db.beforeSession = () => {
        if (action === 'reset') db.sqlite.prepare('UPDATE local_accounts SET password_hash = ? WHERE id = ?').run('changed-by-concurrent-reset', 'alice');
        else db.sqlite.prepare('UPDATE local_accounts SET active = 0 WHERE id = ?').run('alice');
      };
      await assert.rejects(signIn(auth), status(401));
      assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM auth_sessions').get().n, 0);
    } finally { db.close(); }
  }
});

test('account and single project assignment creation is atomic and never exposes password hashes', async () => {
  const { db, auth } = fixture();
  try {
    const account = await auth.createAccount({ id: 'new-person', name: 'New Annotator', email: ' NEW@EXAMPLE.TEST ', password, role: 'annotator' }, [db.prepare('INSERT INTO memberships (project_id,email,user_id,created_at) VALUES (?,?,?,?)').bind('eurlex', 'new@example.test', 'new-person', '2026-11-10T00:00:00Z')]);
    assert.equal(account.email, 'new@example.test'); assert.equal(account.mustChangePassword, true);
    assert.equal(JSON.stringify(account).includes('password'), false);
    await assert.rejects(auth.createAccount({ id: 'duplicate-person', name: 'Duplicate', email: 'new@example.test', password, role: 'annotator' }), status(409));
    await assert.rejects(auth.createAccount({ id: 'rolled-back', name: 'Rolled back', email: 'rollback@example.test', password, role: 'annotator' }, [db.prepare('INSERT INTO memberships (project_id,email,user_id,created_at) VALUES (?,?,?,?)').bind('un', 'new@example.test', 'rolled-back', '2026-11-10T00:00:00Z')]), status(409));
    assert.equal(db.sqlite.prepare('SELECT id FROM local_accounts WHERE id = ?').get('rolled-back'), undefined);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM memberships WHERE email = ?').get('new@example.test').n, 1);
  } finally { db.close(); }
});

test('passwords are independently salted, length checked, and never trimmed or truncated', async () => {
  assert.notEqual(await hashPassword(password), initialHash);
  assert.equal(validatePassword('  Twelve characters  '), '  Twelve characters  ');
  assert.throws(() => validatePassword('short'));
  assert.throws(() => validatePassword('x'.repeat(129)));
  const { db, auth } = fixture();
  try {
    const whitespacePassword = '  Important spaces  ';
    await auth.createAccount({ id: 'spaces', name: 'Spaces', email: 'spaces@example.test', password: whitespacePassword, role: 'annotator' });
    await assert.rejects(signIn(auth, 'spaces@example.test', whitespacePassword.trim()), status(401));
    assert.equal((await signIn(auth, 'spaces@example.test', whitespacePassword)).actor.id, 'spaces');
  } finally { db.close(); }
});

test('session authentication survives database reopening without trusting browser identity fields', async () => {
  const path = join(work, 'auth-persistence.sqlite');
  const { db, auth, clock } = fixture(path);
  const signedIn = await signIn(auth);
  db.close();
  const reopened = new TestDatabase(path, false);
  try {
    const fresh = new AuthService(reopened, () => clock.now);
    assert.equal((await fresh.actor(signedIn.token)).id, 'alice');
    assert.equal(await fresh.actor('local_seedy'), null);
    await fresh.logout(signedIn.token);
    assert.equal(await fresh.actor(signedIn.token), null);
  } finally { reopened.close(); }
});

test('stale annotation tabs cannot silently submit under a newly signed-in account', () => {
  assert.doesNotThrow(() => assertExpectedActor('alice', { id: 'alice' }));
  assert.doesNotThrow(() => assertExpectedActor(null, { id: 'alice' }));
  assert.throws(() => assertExpectedActor('alice', { id: 'bob' }), (error) => error.status === 409 && error.code === 'SESSION_ACCOUNT_MISMATCH');
});
