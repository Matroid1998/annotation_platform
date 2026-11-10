import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';
import defaults from '../lib/server/default-answer-keys.json' with { type: 'json' };
import { localAnswerKeySeedSql } from '../scripts/local-answer-keys.mjs';

const migrationNames = (await readdir(new URL('../drizzle', import.meta.url))).filter((name) => name.endsWith('.sql')).sort();
const migrations = await Promise.all(migrationNames.map((name) => readFile(new URL(`../drizzle/${name}`, import.meta.url), 'utf8')));
const now = '2026-11-10T12:00:00.000Z';
const later = '2026-11-11T12:00:00.000Z';
const version = defaults.version;
const expected = JSON.stringify(['C', 'A', 'D', 'B', 'D', 'A', 'C', 'B', 'C', 'B']);
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const sql of migrations) db.exec(sql);
  return db;
}
function rows(db, table) { return db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all(); }
function snapshot(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return Object.fromEntries(tables.map(({ name }) => [name, rows(db, name)]));
}
function history(db, domain, keyVersion, answers = expected, who = 'admin-1', when = now) {
  db.prepare('INSERT INTO answer_key_versions (domain,version,answers,confirmed_by,confirmed_at) VALUES (?,?,?,?,?)').run(domain, keyVersion, answers, who, when);
}

test('fresh local setup initializes both supplied keys with audit history without qualifying anyone', () => {
  const db = fixture();
  try {
    db.exec(localAnswerKeySeedSql(now));
    assert.equal(rows(db, 'answer_keys').length, 2);
    assert.deepEqual(rows(db, 'answer_key_versions'), rows(db, 'answer_keys'));
    for (const domain of ['legal', 'chemistry']) {
      const key = db.prepare('SELECT * FROM answer_keys WHERE domain = ?').get(domain);
      assert.equal(key.version, 'supplied-guidelines-v1');
      assert.equal(key.answers, expected);
      assert.equal(key.confirmed_by, 'system:local-setup');
      assert.equal(key.confirmed_at, now);
    }
    for (const table of ['qualifications', 'qualification_attempts', 'submissions', 'local_accounts', 'memberships', 'auth_sessions']) assert.equal(rows(db, table).length, 0);
  } finally { db.close(); }
});

test('repeated setup preserves the exact configuration and all other records', () => {
  const db = fixture();
  try {
    db.exec(localAnswerKeySeedSql(now));
    const before = snapshot(db);
    db.exec(localAnswerKeySeedSql(later));
    assert.deepEqual(snapshot(db), before);
  } finally { db.close(); }
});

test('existing administrator keys, historical versions and paid annotations are preserved', () => {
  const db = fixture();
  try {
    const custom = JSON.stringify(['B', 'A', 'D', 'B', 'D', 'A', 'C', 'B', 'C', 'B']);
    history(db, 'legal', 'custom-v2', custom);
    history(db, 'legal', 'earlier-v1');
    db.prepare('INSERT INTO answer_keys SELECT * FROM answer_key_versions WHERE domain = ? AND version = ?').run('legal', 'custom-v2');
    db.prepare('INSERT INTO qualifications (project_id,user_id,version,passed_at) VALUES (?,?,?,?)').run('un', 'annotator-1', 'earlier-v1', now);
    db.prepare('INSERT INTO submissions (id,project_id,document_id,user_id,request_id,payload,qualification_version,saved_at) VALUES (?,?,?,?,?,?,?,?)').run('saved-1', 'un', 'doc-1', 'annotator-1', 'request-1', '{"ratings":[]}', 'earlier-v1', now);
    const keyBefore = db.prepare('SELECT * FROM answer_keys WHERE domain = ?').get('legal');
    const historyBefore = rows(db, 'answer_key_versions');
    const qualsBefore = rows(db, 'qualifications');
    const savedBefore = rows(db, 'submissions');
    db.exec(localAnswerKeySeedSql(later));
    assert.deepEqual(db.prepare('SELECT * FROM answer_keys WHERE domain = ?').get('legal'), keyBefore);
    assert.deepEqual(rows(db, 'answer_key_versions').filter((row) => row.domain === 'legal'), historyBefore);
    assert.deepEqual(rows(db, 'qualifications'), qualsBefore);
    assert.deepEqual(rows(db, 'submissions'), savedBefore);
    assert.equal(db.prepare('SELECT version FROM answer_keys WHERE domain = ?').get('chemistry').version, version);
  } finally { db.close(); }
});

test('a matching historical default is activated using its original audit metadata', () => {
  const db = fixture();
  try {
    history(db, 'legal', version, expected, 'original-admin', '2026-10-01T09:30:00.000Z');
    const original = db.prepare('SELECT * FROM answer_key_versions WHERE domain = ?').get('legal');
    db.exec(localAnswerKeySeedSql(now));
    assert.deepEqual(db.prepare('SELECT * FROM answer_keys WHERE domain = ?').get('legal'), original);
    assert.deepEqual(db.prepare('SELECT * FROM answer_key_versions WHERE domain = ?').get('legal'), original);
  } finally { db.close(); }
});

test('a conflicting historical default version is neither overwritten nor activated', () => {
  const db = fixture();
  try {
    history(db, 'legal', version, JSON.stringify(Array(10).fill('A')));
    const original = db.prepare('SELECT * FROM answer_key_versions WHERE domain = ?').get('legal');
    db.exec(localAnswerKeySeedSql(now));
    assert.equal(db.prepare('SELECT * FROM answer_keys WHERE domain = ?').get('legal'), undefined);
    assert.deepEqual(db.prepare('SELECT * FROM answer_key_versions WHERE domain = ?').get('legal'), original);
    assert.equal(db.prepare('SELECT version FROM answer_keys WHERE domain = ?').get('chemistry').version, version);
  } finally { db.close(); }
});

test('historical attempts, passes and submissions prevent invented history for an already-used default version', () => {
  for (const table of ['qualification_attempts', 'qualifications', 'submissions']) {
    const db = fixture();
    try {
      if (table === 'qualification_attempts') db.prepare('INSERT INTO qualification_attempts (id,project_id,user_id,version,answers,correct,attempted_at) VALUES (?,?,?,?,?,?,?)').run('attempt-1', 'un', 'annotator-1', version, '{}', 0, now);
      if (table === 'qualifications') db.prepare('INSERT INTO qualifications (project_id,user_id,version,passed_at) VALUES (?,?,?,?)').run('eurlex', 'annotator-1', version, now);
      if (table === 'submissions') db.prepare('INSERT INTO submissions (id,project_id,document_id,user_id,request_id,payload,qualification_version,saved_at) VALUES (?,?,?,?,?,?,?,?)').run('saved-1', 'un', 'doc-1', 'annotator-1', 'request-1', '{"ratings":[]}', version, now);
      const before = rows(db, table);
      db.exec(localAnswerKeySeedSql(later));
      assert.equal(db.prepare('SELECT * FROM answer_keys WHERE domain = ?').get('legal'), undefined);
      assert.equal(db.prepare('SELECT * FROM answer_key_versions WHERE domain = ?').get('legal'), undefined);
      assert.deepEqual(rows(db, table), before);
      assert.equal(db.prepare('SELECT version FROM answer_keys WHERE domain = ?').get('chemistry').version, version);
    } finally { db.close(); }
  }
});

test('interrupted setup resumes from its audit row without altering the recorded initialization time', () => {
  const db = fixture();
  try {
    db.exec(localAnswerKeySeedSql(now).split(';')[0] + ';');
    assert.equal(rows(db, 'answer_keys').length, 0);
    assert.equal(rows(db, 'answer_key_versions').length, 1);
    db.exec(localAnswerKeySeedSql(later));
    assert.equal(db.prepare('SELECT confirmed_at FROM answer_keys WHERE domain = ?').get('legal').confirmed_at, now);
    assert.equal(db.prepare('SELECT confirmed_at FROM answer_keys WHERE domain = ?').get('chemistry').confirmed_at, later);
    assert.deepEqual(rows(db, 'answer_keys'), rows(db, 'answer_key_versions'));
  } finally { db.close(); }
});
