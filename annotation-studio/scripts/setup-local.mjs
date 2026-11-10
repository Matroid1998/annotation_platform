import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../lib/server/password.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22.18 or newer is required.');
if (process.env.SITES_MANAGED_LINUX_CONTAINER === '1') throw new Error('This setup command is for a local development database only.');
function run(args, capture = false) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) process.stderr.write(result.stderr || 'Local database command failed.\n');
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

if (!existsSync('.dev.vars')) writeFileSync('.dev.vars', 'AUTH_MODE="local"\n', { mode: 0o600 });
else {
  const current = readFileSync('.dev.vars', 'utf8');
  const mode = current.match(/^AUTH_MODE\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1].trim();
  if (mode && mode !== 'local') throw new Error('Local setup requires AUTH_MODE=local in .dev.vars. Change it explicitly before continuing.');
  if (!mode) writeFileSync('.dev.vars', `${current.trimEnd()}\nAUTH_MODE="local"\n`, { mode: 0o600 });
}
run(['scripts/run-framework.mjs', 'build']);
const config = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
const database = config.d1_databases?.find((binding) => binding.binding === 'DB');
if (!database) throw new Error('Build configuration has no DB binding.');
mkdirSync('.sites-runtime', { recursive: true });
const localConfig = path.join(root, '.sites-runtime/local-database.json');
writeFileSync(localConfig, JSON.stringify({ name: 'annotation-local-setup', compatibility_date: config.compatibility_date,
  d1_databases: [{ ...database, migrations_dir: path.join(root, 'drizzle') }] }, null, 2));
const wrangler = ['--import', './scripts/sites-env.mjs', './node_modules/wrangler/bin/wrangler.js'];
const local = ['--local', '--config', localConfig, '--persist-to', '.wrangler/state'];
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
function query(sql) {
  const output = run([...wrangler, 'd1', 'execute', 'DB', ...local, '--command', sql, '--json'], true);
  const result = JSON.parse(output);
  if (!Array.isArray(result) || result.some((item) => item.success !== true)) throw new Error('The local database did not confirm this operation.');
  return result.flatMap((item) => item.results ?? []);
}

// Retire only the original starter's three automatic administrator assignments.
// Qualification and annotation records are never deleted or reassigned.
const hasMemberships = query("SELECT name FROM sqlite_master WHERE type='table' AND name='memberships'").length > 0;
if (hasMemberships) {
  const retained = "NOT (email = 'seedy@sites.test' AND user_id = 'local_seedy')";
  const conflicts = query(`SELECT email AS identity, COUNT(*) AS count FROM memberships WHERE ${retained} GROUP BY email HAVING COUNT(*) > 1 UNION ALL SELECT user_id AS identity, COUNT(*) AS count FROM memberships WHERE ${retained} AND user_id IS NOT NULL GROUP BY user_id HAVING COUNT(*) > 1`);
  if (conflicts.length) throw new Error('Existing accounts have multiple project assignments. Resolve those assignments before setup; all records have been preserved.');
  query("DELETE FROM memberships WHERE email = 'seedy@sites.test' AND user_id = 'local_seedy'");
}
run([...wrangler, 'd1', 'migrations', 'apply', 'DB', ...local]);

const { SAMPLE_DOCUMENTS } = await import('../lib/sample-documents.ts');
const now = new Date().toISOString();
const sql = [];
for (const [project, documents] of Object.entries(SAMPLE_DOCUMENTS)) {
  for (const doc of documents) {
    const hash = createHash('sha256').update(JSON.stringify([doc.source, doc.question, doc.answer])).digest('hex');
    sql.push(`INSERT OR IGNORE INTO documents (project_id,id,title,source,question,answer,content_hash,created_at) VALUES (${[project,doc.id,doc.title,doc.source,doc.question,doc.answer,hash,now].map(sqlString).join(',')});`);
  }
}
const defaults = [
  { id: 'local_seedy', email: 'seedy@sites.test', name: 'Workspace administrator', role: 'admin', project: null },
  { id: 'local_eurlex_1', email: 'eurlex1@annotation.local', name: 'EUR-Lex annotator 1', role: 'annotator', project: 'eurlex' },
  { id: 'local_eurlex_2', email: 'eurlex2@annotation.local', name: 'EUR-Lex annotator 2', role: 'annotator', project: 'eurlex' },
  { id: 'local_un_1', email: 'un1@annotation.local', name: 'UN annotator 1', role: 'annotator', project: 'un' },
  { id: 'local_chemistry_1', email: 'chemistry1@annotation.local', name: 'Chemistry annotator 1', role: 'annotator', project: 'chemistry' },
];
const existing = query('SELECT id, email FROM local_accounts');
const created = [];
for (const account of defaults) {
  if (existing.some((row) => row.id === account.id || row.email === account.email)) continue;
  const password = randomBytes(24).toString('base64url');
  const hash = await hashPassword(password);
  sql.push(`INSERT INTO local_accounts (id,email,name,password_hash,role,active,must_change_password,created_at,updated_at) VALUES (${[account.id,account.email,account.name,hash,account.role].map(sqlString).join(',')},1,1,${sqlString(now)},${sqlString(now)});`);
  if (account.project) sql.push(`INSERT INTO memberships (project_id,email,user_id,created_at) VALUES (${[account.project,account.email,account.id,now].map(sqlString).join(',')});`);
  created.push({ email: account.email, password, role: account.role, project: account.project });
}
const seedFile = '.sites-runtime/local-sample-seed.sql';
writeFileSync(seedFile, sql.join('\n'), { mode: 0o600 });
chmodSync(seedFile, 0o600);
const credentialsFile = '.sites-runtime/local-credentials.json';
if (created.length) {
  let previous = [];
  if (existsSync(credentialsFile)) previous = JSON.parse(readFileSync(credentialsFile, 'utf8')).accounts ?? [];
  writeFileSync(credentialsFile, JSON.stringify({
    note: 'Initial local passwords only. Each account must change its password on first sign-in. Changed passwords are not stored in this file. Keep this untracked file private.',
    accounts: [...previous.filter((row) => !created.some((account) => account.email === row.email)), ...created],
  }, null, 2) + '\n', { mode: 0o600 });
  chmodSync(credentialsFile, 0o600);
}
// Keep generated credentials recoverable even if the local seed is interrupted.
run([...wrangler, 'd1', 'execute', 'DB', ...local, '--file', seedFile]);
console.log(`\nLocal setup complete. ${created.length} new accounts created. Existing passwords, assignments, qualifications, and submissions were preserved.\n`);
console.log(`Initial credentials: ${path.join(root, credentialsFile)}\nRun npm run dev and open /login. Sign in as seedy@sites.test to manage accounts, projects, and qualification keys.\nEach annotator is assigned to exactly one project; multiple annotators can share that project.\n`);
