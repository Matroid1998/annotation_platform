import { spawnSync } from 'node:child_process';

for (const file of ['tests/backend.test.mjs', 'components/admin/csv.test.mjs']) {
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
