import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath, accountDestination, authRequest } from './client.ts';

test('return paths reject external, protocol-relative, backslash, control, API and login-loop destinations', () => {
  for (const path of ['https://evil.example', '//evil.example', '/\\evil.example', '/\n/evil.example', 'javascript:alert(1)', '/login', '/login?return_to=/', '/account/password', '/account/password?return_to=/', '/api/auth/logout', '/signin-with-chatgpt', '/callback', null]) {
    assert.equal(safeReturnPath(path, '/admin'), '/admin', String(path));
  }
  assert.equal(safeReturnPath('/?project=eurlex#review'), '/?project=eurlex#review');
  assert.equal(safeReturnPath('/admin?project=chemistry'), '/admin?project=chemistry');
});

test('account destinations use the server role and ignore retired password-change flags', () => {
  assert.equal(accountDestination({ isAdmin: true, mustChangePassword: false }), '/admin');
  assert.equal(accountDestination({ isAdmin: false, mustChangePassword: false }), '/');
  for (const route of ['/admin', '/admin?project=un', '/admin#annotators', '/admin/settings']) {
    assert.equal(accountDestination({ isAdmin: false, mustChangePassword: false }, route), '/');
  }
  assert.equal(accountDestination({ isAdmin: true, mustChangePassword: true }, 'https://evil.example'), '/admin');
  assert.equal(accountDestination({ isAdmin: false, mustChangePassword: true }, '/?project=eurlex'), '/?project=eurlex');
  assert.equal(accountDestination({ isAdmin: true, mustChangePassword: true }, '/account/password'), '/admin');
  assert.equal(accountDestination({ isAdmin: false, mustChangePassword: true }, '/account/password'), '/');
});

test('account-bound requests include the expected actor and do not alter passwords', async t => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, ...options };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const body = { action: 'resetAnnotatorPassword', email: 'annotator@example.com', password: '  assigned passphrase  ' };
  assert.deepEqual(await authRequest('/api/admin', body, 'original-admin'), { ok: true });
  assert.equal(request.headers['X-Annotation-Actor'], 'original-admin');
  assert.equal(request.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(request.body), body);
});

test('a rejected account request surfaces only the server error', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Account changed. Sign in again.', code: 'SESSION_ACCOUNT_MISMATCH' }), { status: 409 }));
  await assert.rejects(authRequest('/api/admin', { action: 'resetAnnotatorPassword', email: 'annotator@example.com', password: 'sensitive' }, 'original-admin'), /Account changed\. Sign in again\./);
});
