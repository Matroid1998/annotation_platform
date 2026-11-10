import defaults from '../lib/server/default-answer-keys.json' with { type: 'json' };

const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const projects = { legal: ['eurlex', 'un'], chemistry: ['chemistry'] };

// Initialize local qualification configuration only. The immutable audit row
// comes first, so an interrupted seed can safely be rerun without a partial key.
// Existing administrator keys and historical grading records are never changed.
export function localAnswerKeySeedSql(now = new Date().toISOString()) {
  if (typeof now !== 'string' || !Number.isFinite(Date.parse(now))) throw new TypeError('A valid answer-key initialization timestamp is required.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(defaults.version)) throw new TypeError('Invalid default answer-key version.');
  const statements = [];
  for (const domain of ['legal', 'chemistry']) {
    const answers = defaults.answers[domain];
    if (!Array.isArray(answers) || answers.length !== 10 || answers.some((answer) => !/^[A-D]$/.test(answer))) throw new TypeError(`Invalid default ${domain} answer key.`);
    const domainSql = literal(domain);
    const versionSql = literal(defaults.version);
    const answersSql = literal(JSON.stringify(answers));
    const projectSql = projects[domain].map(literal).join(', ');
    // If old records refer to this version but its history is missing, its
    // original answers cannot be inferred safely. Leave that conflict for admin.
    statements.push(`INSERT INTO answer_key_versions (domain, version, answers, confirmed_by, confirmed_at)
SELECT ${domainSql}, ${versionSql}, ${answersSql}, 'system:local-setup', ${literal(now)}
WHERE NOT EXISTS (SELECT 1 FROM answer_keys WHERE domain = ${domainSql})
  AND NOT EXISTS (SELECT 1 FROM answer_key_versions WHERE domain = ${domainSql} AND version = ${versionSql})
  AND NOT EXISTS (SELECT 1 FROM qualification_attempts WHERE project_id IN (${projectSql}) AND version = ${versionSql})
  AND NOT EXISTS (SELECT 1 FROM qualifications WHERE project_id IN (${projectSql}) AND version = ${versionSql})
  AND NOT EXISTS (SELECT 1 FROM submissions WHERE project_id IN (${projectSql}) AND qualification_version = ${versionSql})
ON CONFLICT(domain, version) DO NOTHING;`);
    // Reuse the original audit metadata only when the stored answers agree.
    // A version collision with different answers must never activate a key.
    statements.push(`INSERT INTO answer_keys (domain, version, answers, confirmed_by, confirmed_at)
SELECT domain, version, answers, confirmed_by, confirmed_at FROM answer_key_versions
WHERE domain = ${domainSql} AND version = ${versionSql} AND answers = ${answersSql}
  AND NOT EXISTS (SELECT 1 FROM answer_keys WHERE domain = ${domainSql})
ON CONFLICT(domain) DO NOTHING;`);
  }
  return `${statements.join('\n\n')}\n`;
}
