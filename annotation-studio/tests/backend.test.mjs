import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const work = await mkdtemp(join(tmpdir(), 'annotation-backend-'));
await build({ entryPoints: [new URL('../lib/server/service.ts', import.meta.url).pathname], outfile: join(work, 'service.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { AnnotationService } = await import(pathToFileURL(join(work, 'service.mjs')).href);
const migrations = (await readdir(new URL('../drizzle', import.meta.url))).filter((name) => name.endsWith('.sql')).sort();
const migrationSQL = await Promise.all(migrations.map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')));
assert.ok(migrations.length, 'Generate actual database migrations before running the tests.');

// Adapter exercises the production SQL and unique constraints against real SQLite,
// with atomic batches and targeted failures at the same D1 await boundaries.
class TestDatabase {
  constructor(path = ':memory:', migrate = true) {
    this.sqlite = new DatabaseSync(path);
    if (migrate) for (const sql of migrationSQL) this.sqlite.exec(sql);
    this.failWrite = false;
    this.loseAcknowledgement = false;
    this.batchQueue = Promise.resolve();
  }
  prepare(sql) {
    const db = this;
    return {
      args: [],
      bind(...args) { this.args = args; return this; },
      async first() {
        if (db.loseAcknowledgement && sql.includes('FROM submissions WHERE id =')) { db.loseAcknowledgement = false; throw Error('Injected lost acknowledgement'); }
        return db.sqlite.prepare(sql).get(...this.args) ?? null;
      },
      async all() { return { results: db.sqlite.prepare(sql).all(...this.args), success: true, meta: {} }; },
      async run() {
        if (db.failWrite && sql.startsWith('INSERT INTO submissions')) { db.failWrite = false; throw Error('Injected unavailable database'); }
        if (db.beforeSave && sql.startsWith('INSERT INTO submissions')) { const callback = db.beforeSave; db.beforeSave = null; callback(); }
        const result = db.sqlite.prepare(sql).run(...this.args);
        return { results: [], success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  async batch(statements) {
    // D1 batches serialize writes and make every statement part of one transaction.
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
const actors = {
  admin: { id: 'admin', name: 'Admin', email: 'admin@example.test', isAdmin: true },
  alice: { id: 'alice', name: 'Alice', email: 'alice@example.test', isAdmin: false },
  bob: { id: 'bob', name: 'Bob', email: 'bob@example.test', isAdmin: false },
  eve: { id: 'eve', name: 'Eve', email: 'eve@example.test', isAdmin: false },
};
const keys = ['C', 'A', 'D', 'B', 'D', 'A', 'C', 'B', 'C', 'B'];
const answers = Object.fromEntries(keys.map((value, index) => [String(index + 1), value]));
const criteria = ['grounding', 'precision', 'numerical_fidelity', 'search_realism', 'standalone_clarity', 'information_value', 'focus_formulation', 'linguistic_quality'];
const input = (id = 'submission-1') => ({ requestId: id, ratings: criteria.map((criterionId) => ({ criterionId, score: 4, comment: '' })), comment: '' });
const document = (id = 'doc-1', source = 'Private source text for the evaluation.') => ({ id, title: `Document ${id}`, source, question: 'What does the source say?', answer: 'The source provides an evaluation.' });
const expectStatus = (status) => (error) => error.status === status;
async function setup(path) {
  const db = new TestDatabase(path);
  const admin = new AnnotationService(db, actors.admin);
  for (const [projectId, email] of [['eurlex', actors.alice.email], ['eurlex', actors.bob.email], ['chemistry', actors.eve.email]]) await admin.adminAction({ action: 'addMember', projectId, email });
  await admin.adminAction({ action: 'importDocuments', projectId: 'eurlex', documents: [document()] });
  await admin.adminAction({ action: 'importDocuments', projectId: 'chemistry', documents: [document()] });
  for (const domain of ['legal', 'chemistry']) await admin.adminAction({ action: 'confirmKey', domain, answers: keys, version: 'v1' });
  const alice = new AnnotationService(db, actors.alice), bob = new AnnotationService(db, actors.bob), eve = new AnnotationService(db, actors.eve);
  await alice.claimInvitations(); await bob.claimInvitations(); await eve.claimInvitations();
  return { db, admin, alice, bob, eve };
}

after(async () => { await rm(work, { recursive: true, force: true }); });

test('membership scopes project lists and prevents direct cross-project document and PDF access', async () => {
  const { db, alice, eve } = await setup();
  try {
    assert.deepEqual((await alice.sessionProjects()).map((p) => p.id), ['eurlex']);
    await assert.rejects(alice.project('chemistry'), expectStatus(404));
    await assert.rejects(alice.document('chemistry', 'doc-1'), expectStatus(404));
    await assert.rejects(eve.assertMember('eurlex', true), expectStatus(404));
    await assert.rejects(alice.adminOverview(), expectStatus(403));
    await assert.rejects(alice.export('eurlex'), expectStatus(403));
  } finally { db.close(); }
});

test('qualification gates all document metadata and contents and requires 10/10', async () => {
  const { db, alice } = await setup();
  try {
    const before = await alice.project('eurlex');
    assert.deepEqual(before.documents, []);
    assert.equal(JSON.stringify(before).includes('Private source'), false);
    assert.equal(JSON.stringify(before).includes('proposedAnswers'), false);
    await assert.rejects(alice.document('eurlex', 'doc-1'), expectStatus(403));
    await assert.rejects(alice.submit('eurlex', 'doc-1', input()), expectStatus(403));
    assert.deepEqual(await alice.qualify('eurlex', { answers: { ...answers, '1': 'A' } }), { passed: false, correct: 9, total: 10 });
    await assert.rejects(alice.document('eurlex', 'doc-1'), expectStatus(403));
    assert.equal((await alice.qualify('eurlex', { answers })).passed, true);
    assert.equal((await alice.document('eurlex', 'doc-1')).source, document().source);
  } finally { db.close(); }
});

test('unconfirmed keys block qualification instead of silently using proposed answers', async () => {
  const { db, alice } = await setup();
  try {
    db.sqlite.exec("DELETE FROM answer_keys WHERE domain = 'legal'");
    assert.equal((await alice.project('eurlex')).qualification.ready, false);
    await assert.rejects(alice.qualify('eurlex', { answers }), expectStatus(409));
  } finally { db.close(); }
});

test('submission is immediately durable across close and reopen, without end-of-project save', async () => {
  const path = join(work, 'durable.sqlite');
  const { db, alice } = await setup(path);
  await alice.qualify('eurlex', { answers });
  const saved = await alice.submit('eurlex', 'doc-1', input());
  assert.ok(saved.id); assert.ok(saved.savedAt);
  db.close();
  const reopened = new TestDatabase(path, false);
  try {
    const recovered = await new AnnotationService(reopened, actors.alice).document('eurlex', 'doc-1');
    assert.equal(recovered.submission.id, saved.id);
    assert.equal(recovered.submission.ratings.length, 8);
    assert.equal(recovered.submission.savedAt, saved.savedAt);
  } finally { reopened.close(); }
});

test('annotators on the same project cannot see each other’s grades or progress', async () => {
  const { db, alice, bob } = await setup();
  try {
    await alice.qualify('eurlex', { answers }); await bob.qualify('eurlex', { answers });
    const payload = input(); payload.comment = 'Alice private comment';
    await alice.submit('eurlex', 'doc-1', payload);
    const own = await bob.document('eurlex', 'doc-1');
    assert.equal(own.submission, null);
    assert.equal((await bob.sessionProjects())[0].submitted, 0);
    assert.equal(JSON.stringify(own).includes('Alice private'), false);
    await bob.submit('eurlex', 'doc-1', input());
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM submissions').get().n, 2);
  } finally { db.close(); }
});

test('double-click and concurrent identical requests return one stable receipt', async () => {
  const { db, alice } = await setup();
  try {
    await alice.qualify('eurlex', { answers });
    const receipts = await Promise.all(Array.from({ length: 12 }, () => alice.submit('eurlex', 'doc-1', input())));
    assert.equal(new Set(receipts.map((r) => r.id)).size, 1);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM submissions').get().n, 1);
  } finally { db.close(); }
});

test('conflicting concurrent payloads cannot overwrite saved annotations', async () => {
  const { db, alice } = await setup();
  try {
    await alice.qualify('eurlex', { answers });
    const one = input(), two = input(); two.comment = 'different';
    const outcomes = await Promise.allSettled([alice.submit('eurlex', 'doc-1', one), alice.submit('eurlex', 'doc-1', two)]);
    assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find((o) => o.status === 'rejected').reason.status, 409);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM submissions').get().n, 1);
    await assert.rejects(alice.submit('eurlex', 'doc-1', input('another-request')), expectStatus(409));
  } finally { db.close(); }
});

test('failed write never returns success and exact retry can save safely', async () => {
  const { db, alice } = await setup();
  try {
    await alice.qualify('eurlex', { answers }); db.failWrite = true;
    await assert.rejects(alice.submit('eurlex', 'doc-1', input()), /Injected unavailable/);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM submissions').get().n, 0);
    assert.ok((await alice.submit('eurlex', 'doc-1', input())).id);
  } finally { db.close(); }
});

test('lost server acknowledgement after committed save recovers the original receipt', async () => {
  const { db, alice } = await setup();
  try {
    await alice.qualify('eurlex', { answers }); db.loseAcknowledgement = true;
    await assert.rejects(alice.submit('eurlex', 'doc-1', input()), /Injected lost acknowledgement/);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM submissions').get().n, 1);
    const receipt = await alice.submit('eurlex', 'doc-1', input());
    assert.equal(receipt.id, db.sqlite.prepare('SELECT id FROM submissions').get().id);
  } finally { db.close(); }
});

test('all eight distinct criteria, valid scores, and required explanations are validated on the server', async () => {
  const { db, alice, eve } = await setup();
  try {
    await alice.qualify('eurlex', { answers }); await eve.qualify('chemistry', { answers });
    const cases = [];
    let p = input(); p.ratings.pop(); cases.push(p);
    p = input(); p.ratings[7] = p.ratings[0]; cases.push(p);
    for (const score of [0, 6, 2.5, '4', undefined]) { p = input(); p.ratings[0].score = score; cases.push(p); }
    for (const score of [1, 2, 3, 5, null]) { p = input(); p.ratings[0].score = score; p.ratings[0].comment = '   '; cases.push(p); }
    for (const invalid of cases) await assert.rejects(alice.submit('eurlex', 'doc-1', invalid), expectStatus(400));
    await assert.rejects(eve.submit('chemistry', 'doc-1', input()), expectStatus(400));
    const chemistry = input(); for (const r of chemistry.ratings) r.comment = 'Specific supporting reason';
    assert.ok((await eve.submit('chemistry', 'doc-1', chemistry)).id);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM submissions WHERE project_id = 'eurlex'").get().n, 0);
  } finally { db.close(); }
});

test('cannot assess has a reason and numerical not-applicable uses 4 with its comment', async () => {
  const { db, alice } = await setup();
  try {
    await alice.qualify('eurlex', { answers });
    const p = input(); p.ratings[0] = { criterionId: 'grounding', score: null, comment: 'Required source appendix is missing.' }; p.ratings[2].comment = 'not applicable';
    await alice.submit('eurlex', 'doc-1', p);
    const saved = (await alice.document('eurlex', 'doc-1')).submission;
    assert.equal(saved.ratings[0].score, null); assert.equal(saved.ratings[2].score, 4); assert.equal(saved.ratings[2].comment, 'not applicable');
  } finally { db.close(); }
});

test('revoked membership prevents reads, submissions and receipt replay without deleting saved work', async () => {
  const { db, alice, admin } = await setup();
  try {
    await alice.qualify('eurlex', { answers }); await alice.submit('eurlex', 'doc-1', input());
    await admin.adminAction({ action: 'removeMember', projectId: 'eurlex', email: actors.alice.email });
    await assert.rejects(alice.document('eurlex', 'doc-1'), expectStatus(404));
    await assert.rejects(alice.submit('eurlex', 'doc-1', input()), expectStatus(404));
    assert.equal((await admin.export('eurlex')).annotations.length, 1);
  } finally { db.close(); }
});

test('membership revocation between validation and insertion cannot race through the save gate', async () => {
  const { db, alice } = await setup();
  try {
    await alice.qualify('eurlex', { answers });
    db.beforeSave = () => db.sqlite.prepare('DELETE FROM memberships WHERE project_id = ? AND user_id = ?').run('eurlex', 'alice');
    await assert.rejects(alice.submit('eurlex', 'doc-1', input()), expectStatus(409));
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM submissions').get().n, 0);
  } finally { db.close(); }
});

test('answer-key change between validation and insertion cannot bypass current qualification', async () => {
  const { db, alice } = await setup();
  try {
    await alice.qualify('eurlex', { answers });
    db.beforeSave = () => db.sqlite.prepare('UPDATE answer_keys SET version = ? WHERE domain = ?').run('v2', 'legal');
    await assert.rejects(alice.submit('eurlex', 'doc-1', input()), expectStatus(409));
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM submissions').get().n, 0);
  } finally { db.close(); }
});

test('answer key revisions invalidate prior qualification and preserve audit history', async () => {
  const { db, alice, admin } = await setup();
  try {
    await alice.qualify('eurlex', { answers }); await alice.submit('eurlex', 'doc-1', input());
    await assert.rejects(admin.adminAction({ action: 'confirmKey', domain: 'legal', answers: [...keys.slice(0, 9), 'A'], version: 'v1' }), expectStatus(409));
    await admin.adminAction({ action: 'confirmKey', domain: 'legal', answers: keys, version: 'v2' });
    assert.equal((await alice.project('eurlex')).qualification.passed, false);
    await assert.rejects(alice.document('eurlex', 'doc-1'), expectStatus(403));
    assert.ok((await alice.submit('eurlex', 'doc-1', input())).id, 'Committed receipt retry still works after key revision.');
    await assert.rejects(admin.adminAction({ action: 'confirmKey', domain: 'legal', answers: keys, version: 'v1' }), expectStatus(409));
    const exported = await admin.export('eurlex');
    assert.equal(exported.answerKeys.length, 2); assert.equal(exported.annotations[0].qualificationVersion, 'v1');
  } finally { db.close(); }
});

test('concurrent administrators cannot give the same answer-key version conflicting meanings', async () => {
  const { db, admin } = await setup();
  try {
    const otherAdmin = new AnnotationService(db, { ...actors.admin, id: 'second-admin' });
    const alternate = [...keys]; alternate[0] = 'A';
    const outcomes = await Promise.allSettled([
      admin.adminAction({ action: 'confirmKey', domain: 'legal', answers: keys, version: 'v2' }),
      otherAdmin.adminAction({ action: 'confirmKey', domain: 'legal', answers: alternate, version: 'v2' }),
    ]);
    assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find((o) => o.status === 'rejected').reason.status, 409);
    const active = db.sqlite.prepare("SELECT * FROM answer_keys WHERE domain = 'legal'").get();
    const historical = db.sqlite.prepare("SELECT * FROM answer_key_versions WHERE domain = 'legal' AND version = 'v2'").get();
    assert.equal(active.answers, historical.answers);
    assert.equal(active.confirmed_by, historical.confirmed_by);
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM answer_key_versions WHERE domain = 'legal'").get().n, 2);
  } finally { db.close(); }
});

test('stable user identity retains assignment after an identity-provider email update', async () => {
  const { db } = await setup();
  try {
    const renamed = new AnnotationService(db, { ...actors.alice, email: 'new-email@example.test' });
    await renamed.claimInvitations();
    assert.equal((await renamed.sessionProjects())[0].id, 'eurlex');
  } finally { db.close(); }
});

test('CSV import is atomic and repeated content with changed IDs cannot duplicate documents', async () => {
  const { db, admin } = await setup();
  try {
    await assert.rejects(admin.adminAction({ action: 'importDocuments', projectId: 'eurlex', documents: [document('doc-2', 'A new source'), document('new-id')] }), expectStatus(409));
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM documents WHERE project_id = 'eurlex'").get().n, 1);
    await assert.rejects(admin.adminAction({ action: 'importDocuments', projectId: 'eurlex', documents: [document('doc-2', 'Same source'), document('doc-3', 'Same source')] }), expectStatus(409));
  } finally { db.close(); }
});

test('invitation claims use verified identity once and cannot be stolen by a different account', async () => {
  const { db, alice } = await setup();
  try {
    const impostor = new AnnotationService(db, { ...actors.alice, id: 'other-stable-id' });
    await impostor.claimInvitations();
    await assert.rejects(impostor.project('eurlex'), expectStatus(404));
    assert.equal((await alice.sessionProjects()).length, 1);
  } finally { db.close(); }
});
