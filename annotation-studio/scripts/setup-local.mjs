import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22.18 or newer is required.');
if (process.env.SITES_MANAGED_LINUX_CONTAINER === '1') throw new Error('This setup command is for a local development database only.');
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!existsSync('.dev.vars')) writeFileSync('.dev.vars', 'ADMIN_EMAILS="seedy@sites.test"\n');
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
run([...wrangler, 'd1', 'migrations', 'apply', 'DB', ...local]);

const { SAMPLE_DOCUMENTS } = await import('../lib/sample-documents.ts');
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const now = new Date().toISOString();
const sql = [];
for (const [project, documents] of Object.entries(SAMPLE_DOCUMENTS)) {
  sql.push(`INSERT OR IGNORE INTO memberships (project_id,email,user_id,created_at) VALUES (${[project, 'seedy@sites.test', 'local_seedy', now].map(sqlString).join(',')});`);
  for (const doc of documents) {
    const hash = createHash('sha256').update(JSON.stringify([doc.source, doc.question, doc.answer])).digest('hex');
    sql.push(`INSERT OR IGNORE INTO documents (project_id,id,title,source,question,answer,content_hash,created_at) VALUES (${[project,doc.id,doc.title,doc.source,doc.question,doc.answer,hash,now].map(sqlString).join(',')});`);
  }
}
const seedFile = '.sites-runtime/local-sample-seed.sql';
writeFileSync(seedFile, sql.join('\n'));
run([...wrangler, 'd1', 'execute', 'DB', ...local, '--file', seedFile]);
console.log('\nLocal setup complete. Run npm run dev, sign in, then open Administration to review and confirm both qualification keys. No test has been bypassed.\n');
