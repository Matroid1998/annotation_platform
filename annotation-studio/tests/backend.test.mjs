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
await build({ entryPoints: [new URL('../lib/server/auth.ts', import.meta.url).pathname], outfile: join(work, 'auth.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { AuthService } = await import(pathToFileURL(join(work, 'auth.mjs')).href);
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
        if (db.beforeQualification && sql.startsWith('INSERT INTO qualification_attempts')) { const callback = db.beforeQualification; db.beforeQualification = null; callback(); }
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
function seedAccount(db, actor) {
  const now = new Date().toISOString();
  db.sqlite.prepare('INSERT INTO local_accounts (id,email,name,password_hash,role,active,must_change_password,created_at,updated_at) VALUES (?,?,?,?,?,1,0,?,?)').run(actor.id, actor.email, actor.name, 'test-only-password-placeholder', actor.isAdmin ? 'admin' : 'annotator', now, now);
}
async function setup(path, { acknowledge = true } = {}) {
  const db = new TestDatabase(path);
  for (const actor of Object.values(actors)) seedAccount(db, actor);
  const admin = new AnnotationService(db, actors.admin);
  for (const [projectId, email] of [['eurlex', actors.alice.email], ['eurlex', actors.bob.email], ['chemistry', actors.eve.email]]) await admin.adminAction({ action: 'addMember', projectId, email });
  await admin.adminAction({ action: 'importDocuments', projectId: 'eurlex', documents: [document()] });
  await admin.adminAction({ action: 'importDocuments', projectId: 'chemistry', documents: [document()] });
  for (const domain of ['legal', 'chemistry']) await admin.adminAction({ action: 'confirmKey', domain, answers: keys, version: 'v1' });
  const alice = new AnnotationService(db, actors.alice), bob = new AnnotationService(db, actors.bob), eve = new AnnotationService(db, actors.eve);
  await alice.claimInvitations(); await bob.claimInvitations(); await eve.claimInvitations();
  if (acknowledge) {
    await alice.acknowledgeGuideline('eurlex', { acknowledged: true });
    await bob.acknowledgeGuideline('eurlex', { acknowledged: true });
    await eve.acknowledgeGuideline('chemistry', { acknowledged: true });
  }
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

test('answer-key change during annotation save does not revoke a permanent qualification', async () => {
  const { db, alice } = await setup();
  try {
    await alice.qualify('eurlex', { answers });
    db.beforeSave = () => db.sqlite.prepare('UPDATE answer_keys SET version = ? WHERE domain = ?').run('v2', 'legal');
    assert.ok((await alice.submit('eurlex', 'doc-1', input())).id);
    assert.equal(db.sqlite.prepare('SELECT qualification_version FROM submissions').get().qualification_version, 'v1');
  } finally { db.close(); }
});

test('answer key revisions preserve permanent qualification and original submission audit version', async () => {
  const { db, alice, admin } = await setup();
  try {
    await alice.qualify('eurlex', { answers }); await alice.submit('eurlex', 'doc-1', input());
    const originalPassedAt = (await alice.project('eurlex')).qualification.passedAt;
    await assert.rejects(admin.adminAction({ action: 'confirmKey', domain: 'legal', answers: [...keys.slice(0, 9), 'A'], version: 'v1' }), expectStatus(409));
    await admin.adminAction({ action: 'confirmKey', domain: 'legal', answers: keys, version: 'v2' });
    assert.equal((await alice.project('eurlex')).qualification.passed, true);
    assert.equal((await alice.project('eurlex')).qualification.version, 'v1');
    assert.equal((await alice.document('eurlex', 'doc-1')).source, document().source);
    assert.ok((await alice.submit('eurlex', 'doc-1', input())).id, 'Committed receipt retry still works after key revision.');
    await admin.adminAction({ action: 'importDocuments', projectId: 'eurlex', documents: [document('doc-2', 'A second source after the key revision.')] });
    assert.ok((await alice.submit('eurlex', 'doc-2', input('second-submission'))).id);
    await assert.rejects(admin.adminAction({ action: 'confirmKey', domain: 'legal', answers: keys, version: 'v1' }), expectStatus(409));
    const exported = await admin.export('eurlex');
    assert.equal(exported.answerKeys.length, 2);
    assert.deepEqual(exported.annotations.map((item) => item.qualificationVersion), ['v1', 'v1']);
    assert.deepEqual(exported.annotations.map((item) => item.qualificationPassedAt), [originalPassedAt, originalPassedAt]);
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

test('first visit exposes only guidelines, then the test, then annotation after all ten correct answers', async () => {
  const { db, alice } = await setup(undefined, { acknowledge: false });
  try {
    const first = await alice.project('eurlex');
    assert.deepEqual(first.questions, []);
    assert.deepEqual(first.documents, []);
    assert.equal(first.qualification.guidelineRead, false);
    assert.equal(first.qualification.guidelineReadAt, null);
    assert.equal(first.qualification.passedAt, null);
    await assert.rejects(alice.qualify('eurlex', { answers }), expectStatus(403));
    await assert.rejects(alice.document('eurlex', 'doc-1'), expectStatus(403));
    await assert.rejects(alice.submit('eurlex', 'doc-1', input()), expectStatus(403));
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM qualification_attempts').get().n, 0);
    for (const acknowledged of [false, 'true', 1, null, undefined]) {
      await assert.rejects(alice.acknowledgeGuideline('eurlex', { acknowledged }), expectStatus(400));
    }
    const acknowledged = await alice.acknowledgeGuideline('eurlex', { acknowledged: true });
    assert.equal(acknowledged.guidelineRead, true);
    assert.ok(acknowledged.guidelineReadAt);
    const testStage = await alice.project('eurlex');
    assert.equal(testStage.questions.length, 10);
    assert.deepEqual(testStage.documents, []);
    await assert.rejects(alice.document('eurlex', 'doc-1'), expectStatus(403));
    await assert.rejects(alice.submit('eurlex', 'doc-1', input()), expectStatus(403));
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.deepEqual(await alice.qualify('eurlex', { answers: { ...answers, '10': 'A' } }), { passed: false, correct: 9, total: 10 });
      assert.equal((await alice.project('eurlex')).qualification.passed, false);
      await assert.rejects(alice.document('eurlex', 'doc-1'), expectStatus(403));
      await assert.rejects(alice.submit('eurlex', 'doc-1', input()), expectStatus(403));
    }
    assert.deepEqual(await alice.qualify('eurlex', { answers }), { passed: true, correct: 10, total: 10 });
    const passed = await alice.project('eurlex');
    assert.equal(passed.qualification.passed, true);
    assert.ok(passed.qualification.passedAt);
    assert.deepEqual(passed.questions, []);
    assert.equal(passed.documents.length, 1);
    assert.equal((await alice.document('eurlex', 'doc-1')).source, document().source);
    assert.ok((await alice.submit('eurlex', 'doc-1', input())).id);
  } finally { db.close(); }
});

test('guideline acknowledgement is idempotent and isolated by annotator and project even for the same legal PDF', async () => {
  const { db, admin, alice, bob } = await setup(undefined, { acknowledge: false });
  try {
    const unActor = { id: 'un-reader', email: 'un-reader@example.test', name: 'UN Reader', isAdmin: false };
    seedAccount(db, unActor);
    await admin.adminAction({ action: 'addMember', projectId: 'un', email: unActor.email });
    const unReader = new AnnotationService(db, unActor);
    await assert.rejects(alice.acknowledgeGuideline('chemistry', { acknowledged: true }), expectStatus(404));
    const first = await alice.acknowledgeGuideline('eurlex', { acknowledged: true });
    const repeated = await alice.acknowledgeGuideline('eurlex', { acknowledged: true });
    assert.equal(repeated.guidelineReadAt, first.guidelineReadAt);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM guideline_acknowledgements').get().n, 1);
    assert.equal((await unReader.project('un')).qualification.guidelineRead, false);
    assert.equal((await bob.project('eurlex')).qualification.guidelineRead, false);
    await assert.rejects(alice.qualify('un', { answers }), expectStatus(404));
    await assert.rejects(unReader.qualify('un', { answers }), expectStatus(403));
    await assert.rejects(bob.qualify('eurlex', { answers }), expectStatus(403));
    await alice.qualify('eurlex', { answers });
    assert.equal((await unReader.project('un')).qualification.passed, false);
    assert.equal((await bob.project('eurlex')).qualification.passed, false);
  } finally { db.close(); }
});

test('successful qualification happens once under concurrent submissions and repeated test requests never mutate it', async () => {
  const { db, alice, admin } = await setup();
  try {
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => alice.qualify('eurlex', { answers })));
    assert.equal(outcomes.every((outcome) => outcome.passed && outcome.correct === 10), true);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM qualifications').get().n, 1);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM qualification_attempts').get().n, 1);
    const original = (await alice.project('eurlex')).qualification;
    await admin.adminAction({ action: 'confirmKey', domain: 'legal', answers: [...keys.slice(0, 9), 'A'], version: 'v2' });
    for (const body of [null, {}, { answers: {} }, { answers: Object.fromEntries(keys.map((_, index) => [String(index + 1), 'A'])) }]) {
      assert.deepEqual(await alice.qualify('eurlex', body), { passed: true, correct: 10, total: 10 });
    }
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM qualifications').get().n, 1);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM qualification_attempts').get().n, 1);
    assert.deepEqual((await alice.project('eurlex')).qualification, original);
  } finally { db.close(); }
});

test('acknowledgement and permanent qualification survive reopening the database and creating a new service', async () => {
  const path = join(work, 'permanent-qualification.sqlite');
  const { db, alice } = await setup(path, { acknowledge: false });
  const acknowledged = await alice.acknowledgeGuideline('eurlex', { acknowledged: true });
  db.close();
  let reopened = new TestDatabase(path, false);
  const reentered = new AnnotationService(reopened, actors.alice);
  assert.equal((await reentered.project('eurlex')).qualification.guidelineReadAt, acknowledged.guidelineReadAt);
  assert.equal((await reentered.project('eurlex')).questions.length, 10);
  await reentered.qualify('eurlex', { answers });
  const original = (await reentered.project('eurlex')).qualification;
  reopened.close();
  reopened = new TestDatabase(path, false);
  try {
    const returning = new AnnotationService(reopened, actors.alice);
    const admin = new AnnotationService(reopened, actors.admin);
    await admin.adminAction({ action: 'confirmKey', domain: 'legal', answers: keys, version: 'v2' });
    assert.deepEqual((await returning.project('eurlex')).qualification, original);
    assert.equal((await returning.sessionProjects())[0].qualified, true);
    assert.equal((await returning.project('eurlex')).questions.length, 0);
    assert.equal((await returning.document('eurlex', 'doc-1')).source, document().source);
    await returning.submit('eurlex', 'doc-1', input());
    assert.equal(reopened.sqlite.prepare('SELECT qualification_version FROM submissions').get().qualification_version, 'v1');
  } finally { reopened.close(); }
});

test('legacy passed accounts need no new acknowledgement or active answer key and retain their earliest pass', async () => {
  const { db, alice } = await setup(undefined, { acknowledge: false });
  try {
    db.sqlite.prepare('INSERT INTO qualifications (project_id, user_id, version, passed_at) VALUES (?, ?, ?, ?)').run('eurlex', 'alice', 'v1', '2026-11-01T10:00:00.000Z');
    db.sqlite.prepare('INSERT INTO qualifications (project_id, user_id, version, passed_at) VALUES (?, ?, ?, ?)').run('eurlex', 'alice', 'v2', '2026-11-02T10:00:00.000Z');
    db.sqlite.prepare('DELETE FROM answer_keys WHERE domain = ?').run('legal');
    const status = (await alice.project('eurlex')).qualification;
    assert.deepEqual(status, { passed: true, ready: true, version: 'v1', guidelineRead: true, guidelineReadAt: '2026-11-01T10:00:00.000Z', passedAt: '2026-11-01T10:00:00.000Z' });
    assert.equal((await alice.document('eurlex', 'doc-1')).source, document().source);
    assert.deepEqual(await alice.qualify('eurlex', {}), { passed: true, correct: 10, total: 10 });
    await alice.submit('eurlex', 'doc-1', input());
    assert.equal(db.sqlite.prepare('SELECT qualification_version FROM submissions').get().qualification_version, 'v1');
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM qualification_attempts').get().n, 0);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM guideline_acknowledgements').get().n, 0);
  } finally { db.close(); }
});

test('removing and restoring membership preserves a past pass but never grants access during removal', async () => {
  const { db, admin, alice } = await setup();
  try {
    await alice.qualify('eurlex', { answers });
    const original = (await alice.project('eurlex')).qualification;
    await admin.adminAction({ action: 'removeMember', projectId: 'eurlex', email: actors.alice.email });
    await assert.rejects(alice.project('eurlex'), expectStatus(404));
    await assert.rejects(alice.document('eurlex', 'doc-1'), expectStatus(404));
    await assert.rejects(alice.submit('eurlex', 'doc-1', input()), expectStatus(404));
    await assert.rejects(alice.qualify('eurlex', { answers }), expectStatus(404));
    await assert.rejects(alice.acknowledgeGuideline('eurlex', { acknowledged: true }), expectStatus(404));
    await admin.adminAction({ action: 'addMember', projectId: 'eurlex', email: actors.alice.email });
    await alice.claimInvitations();
    assert.deepEqual((await alice.project('eurlex')).qualification, original);
    assert.equal((await alice.document('eurlex', 'doc-1')).source, document().source);
    assert.ok((await alice.submit('eurlex', 'doc-1', input())).id);
  } finally { db.close(); }
});

test('qualification transaction rechecks guideline acknowledgement and the answer key before granting the first pass', async () => {
  for (const change of ['acknowledgement', 'key']) {
    const { db, alice } = await setup();
    try {
      db.beforeQualification = () => {
        if (change === 'acknowledgement') db.sqlite.prepare('DELETE FROM guideline_acknowledgements WHERE project_id = ? AND user_id = ?').run('eurlex', 'alice');
        else db.sqlite.prepare('UPDATE answer_keys SET version = ? WHERE domain = ?').run('v2', 'legal');
      };
      await assert.rejects(alice.qualify('eurlex', { answers }), expectStatus(409));
      assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM qualification_attempts').get().n, 0);
      assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM qualifications').get().n, 0);
      await assert.rejects(alice.document('eurlex', 'doc-1'), expectStatus(403));
    } finally { db.close(); }
  }
});

test('one project accepts many annotators but one annotator cannot be assigned to a second project', async () => {
  const { db, admin, alice } = await setup();
  try {
    assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM memberships WHERE project_id='eurlex'").get().n, 2);
    await assert.rejects(admin.adminAction({ action: 'addMember', projectId: 'un', email: actors.alice.email }), expectStatus(409));
    await admin.adminAction({ action: 'addMember', projectId: 'eurlex', email: actors.alice.email });
    assert.deepEqual((await alice.sessionProjects()).map((project) => project.id), ['eurlex']);
    assert.throws(() => db.sqlite.prepare('INSERT INTO memberships(project_id,email,user_id,created_at) VALUES(?,?,?,?)').run('un', actors.alice.email, 'another-id', new Date().toISOString()), /UNIQUE/);
    assert.throws(() => db.sqlite.prepare('INSERT INTO memberships(project_id,email,user_id,created_at) VALUES(?,?,?,?)').run('un', 'different@example.test', actors.alice.id, new Date().toISOString()), /UNIQUE/);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM memberships WHERE user_id=?').get('alice').n, 1);
  } finally { db.close(); }
});

test('concurrent project assignments have exactly one winner and never silently reassign', async () => {
  const { db, admin } = await setup();
  try {
    const actor = { id: 'available', name: 'Available', email: 'available@example.test', isAdmin: false };
    seedAccount(db, actor);
    const outcomes = await Promise.allSettled(['eurlex', 'un', 'chemistry'].map((projectId) => admin.adminAction({ action: 'addMember', projectId, email: actor.email })));
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected' && outcome.reason.status === 409).length, 2);
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM memberships WHERE user_id=?').get(actor.id).n, 1);
    assert.equal((await new AnnotationService(db, actor).sessionProjects()).length, 1);
  } finally { db.close(); }
});

test('legacy multiple assignments fail closed for project lists, content, qualification and saving', async () => {
  const { db, alice } = await setup();
  try {
    await alice.qualify('eurlex', { answers });
    await alice.submit('eurlex', 'doc-1', input());
    db.sqlite.exec('DROP INDEX one_project_per_email; DROP INDEX one_project_per_user;');
    db.sqlite.prepare('INSERT INTO memberships(project_id,email,user_id,created_at) VALUES(?,?,?,?)').run('un', actors.alice.email, actors.alice.id, new Date().toISOString());
    await assert.rejects(alice.sessionProjects(), expectStatus(409));
    await assert.rejects(alice.project('eurlex'), expectStatus(409));
    await assert.rejects(alice.project('un'), expectStatus(409));
    await assert.rejects(alice.document('eurlex', 'doc-1'), expectStatus(409));
    await assert.rejects(alice.qualify('eurlex', { answers }), expectStatus(409));
    await assert.rejects(alice.acknowledgeGuideline('eurlex', { acknowledged: true }), expectStatus(409));
    await assert.rejects(alice.submit('eurlex', 'doc-1', input()), expectStatus(409));
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM submissions').get().n, 1);
  } finally { db.close(); }
});

test('administrator creates an individual annotator account atomically and cannot elevate it via submitted fields', async () => {
  const { db, admin, alice } = await setup();
  try {
    const payload = { action: 'createAnnotator', projectId: 'un', name: 'New Annotator', email: 'NEW@example.test', password: 'Temporary passphrase 123!', role: 'admin', isAdmin: true, mustChangePassword: false };
    await assert.rejects(alice.adminAction(payload), expectStatus(403));
    const created = await admin.adminAction(payload);
    assert.equal(created.account.role, 'annotator');
    assert.equal(created.account.mustChangePassword, true);
    assert.equal(created.account.email, 'new@example.test');
    assert.equal('password_hash' in created.account, false);
    const row = db.sqlite.prepare('SELECT * FROM local_accounts WHERE id=?').get(created.account.id);
    assert.match(row.password_hash, /^scrypt\$/);
    assert.notEqual(row.password_hash, payload.password);
    assert.equal(row.role, 'annotator');
    assert.equal(row.must_change_password, 1);
    assert.equal(db.sqlite.prepare('SELECT project_id FROM memberships WHERE user_id=?').get(row.id).project_id, 'un');
    const login = await new AuthService(db).login({ email: row.email, password: payload.password }, 'new-account-test');
    assert.equal(login.actor.isAdmin, false);
    assert.equal(login.actor.mustChangePassword, true);
    await assert.rejects(admin.adminAction(payload), expectStatus(409));
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM local_accounts WHERE email=?').get(row.email).n, 1);
    const overview = await admin.adminOverview();
    assert.equal(overview.accounts.find((entry) => entry.id === row.id).projectId, 'un');
    for (const secret of [row.password_hash, login.token, 'password_hash', 'token_hash']) assert.equal(JSON.stringify(overview).includes(secret), false);
  } finally { db.close(); }
});

test('account creation rolls back when an existing legacy assignment would violate the one-project constraint', async () => {
  const { db, admin } = await setup();
  try {
    db.sqlite.prepare('INSERT INTO memberships(project_id,email,user_id,created_at) VALUES(?,?,NULL,?)').run('eurlex', 'pending@example.test', new Date().toISOString());
    await assert.rejects(admin.adminAction({ action: 'createAnnotator', projectId: 'un', name: 'Pending', email: 'pending@example.test', password: 'Temporary passphrase 123!' }), expectStatus(409));
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM local_accounts WHERE email=?').get('pending@example.test').n, 0);
    assert.equal(db.sqlite.prepare('SELECT project_id FROM memberships WHERE email=?').get('pending@example.test').project_id, 'eurlex');
  } finally { db.close(); }
});

test('annotator controls cannot assign, reset or disable administrator accounts', async () => {
  const { db, admin, alice } = await setup();
  try {
    for (const payload of [
      { action: 'addMember', projectId: 'eurlex', email: actors.admin.email },
      { action: 'resetAnnotatorPassword', email: actors.admin.email, password: 'Replacement secret 123!' },
      { action: 'setAnnotatorActive', email: actors.admin.email, active: false },
    ]) await assert.rejects(admin.adminAction(payload), expectStatus(403));
    await assert.rejects(alice.adminAction({ action: 'resetAnnotatorPassword', email: actors.bob.email, password: 'Replacement secret 123!' }), expectStatus(403));
    assert.deepEqual(await admin.sessionProjects(), []);
    assert.equal((await admin.adminOverview()).projects.length, 3);
    assert.equal(db.sqlite.prepare('SELECT active FROM local_accounts WHERE id=?').get('admin').active, 1);
  } finally { db.close(); }
});

test('password reset and account suspension revoke sessions without changing qualifications or paid annotations', async () => {
  const { db, admin, alice } = await setup();
  try {
    await alice.qualify('eurlex', { answers });
    const receipt = await alice.submit('eurlex', 'doc-1', input());
    const beforePass = db.sqlite.prepare('SELECT * FROM qualifications WHERE user_id=?').get('alice');
    const beforeSubmission = db.sqlite.prepare('SELECT * FROM submissions WHERE user_id=?').get('alice');
    const auth = new AuthService(db);
    await auth.resetPassword('alice', 'Initial unique password 123!', { mustChangePassword: false });
    const signedIn = await auth.login({ email: actors.alice.email, password: 'Initial unique password 123!' }, 'reset-test');
    await admin.adminAction({ action: 'resetAnnotatorPassword', email: actors.alice.email, password: 'Replacement secret 456!' });
    assert.equal(await auth.actor(signedIn.token), null);
    assert.equal(db.sqlite.prepare('SELECT must_change_password FROM local_accounts WHERE id=?').get('alice').must_change_password, 1);
    const nextLogin = await auth.login({ email: actors.alice.email, password: 'Replacement secret 456!' }, 'reset-test');
    assert.equal(nextLogin.actor.mustChangePassword, true);
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM qualifications WHERE user_id=?').get('alice'), beforePass);
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM submissions WHERE user_id=?').get('alice'), beforeSubmission);
    assert.equal((await alice.document('eurlex', 'doc-1')).submission.id, receipt.id);
    await admin.adminAction({ action: 'setAnnotatorActive', email: actors.alice.email, active: false });
    assert.equal(await auth.actor(nextLogin.token), null);
    await assert.rejects(auth.login({ email: actors.alice.email, password: 'Replacement secret 456!' }, 'reset-test'), expectStatus(401));
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM memberships WHERE user_id=?').get('alice').n, 1);
    assert.deepEqual(db.sqlite.prepare('SELECT * FROM submissions WHERE user_id=?').get('alice'), beforeSubmission);
    await admin.adminAction({ action: 'setAnnotatorActive', email: actors.alice.email, active: true });
    assert.ok((await auth.login({ email: actors.alice.email, password: 'Replacement secret 456!' }, 'reset-test')).actor);
  } finally { db.close(); }
});

test('moving an annotator requires explicit removal, preserves past work, and requires the new project qualification', async () => {
  const { db, admin, alice } = await setup();
  try {
    await alice.qualify('eurlex', { answers });
    await alice.submit('eurlex', 'doc-1', input());
    await assert.rejects(admin.adminAction({ action: 'addMember', projectId: 'un', email: actors.alice.email }), expectStatus(409));
    await admin.adminAction({ action: 'removeMember', projectId: 'eurlex', email: actors.alice.email });
    await admin.adminAction({ action: 'addMember', projectId: 'un', email: actors.alice.email });
    assert.deepEqual((await alice.sessionProjects()).map((project) => project.id), ['un']);
    assert.equal((await alice.project('un')).qualification.passed, false);
    assert.equal((await alice.project('un')).qualification.guidelineRead, false);
    await assert.rejects(alice.project('eurlex'), expectStatus(404));
    const historical = await admin.export('eurlex');
    assert.equal(historical.annotations.length, 1);
    assert.equal(historical.annotations[0].userId, 'alice');
    await admin.adminAction({ action: 'removeMember', projectId: 'un', email: actors.alice.email });
    await admin.adminAction({ action: 'addMember', projectId: 'eurlex', email: actors.alice.email });
    assert.equal((await alice.project('eurlex')).qualification.passed, true);
    assert.ok((await alice.document('eurlex', 'doc-1')).submission.id);
  } finally { db.close(); }
});
