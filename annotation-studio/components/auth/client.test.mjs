import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeReturnPath, accountDestination, authRequest } from './client.ts';

test('return paths reject external, protocol-relative, backslash, control, API and login-loop destinations', () => {
  for (const path of ['https://evil.example', '//evil.example', '/\\evil.example', '/\n/evil.example', 'javascript:alert(1)', '/login', '/login?return_to=/', '/api/auth/logout', '/signin-with-chatgpt', '/callback', null]) {
    assert.equal(safeReturnPath(path, '/admin'), '/admin', String(path));
  }
  assert.equal(safeReturnPath('/?project=eurlex#review'), '/?project=eurlex#review');
  assert.equal(safeReturnPath('/admin?project=chemistry'), '/admin?project=chemistry');
});

test('account destinations use the server role and force required password changes first', () => {
  assert.equal(accountDestination({ isAdmin: true, mustChangePassword: false }), '/admin');
  assert.equal(accountDestination({ isAdmin: false, mustChangePassword: false }), '/');
  for (const route of ['/admin', '/admin?project=un', '/admin#annotators', '/admin/settings']) {
    assert.equal(accountDestination({ isAdmin: false, mustChangePassword: false }, route), '/');
  }
  assert.equal(accountDestination({ isAdmin: true, mustChangePassword: true }, 'https://evil.example'), '/account/password');
  assert.equal(accountDestination({ isAdmin: false, mustChangePassword: true }, '/?project=eurlex'), '/account/password?return_to=%2F%3Fproject%3Deurlex');
});

test('account-bound requests include the expected actor and do not alter passwords', async t => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    request = { url, ...options };
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  const body = { currentPassword: '  current passphrase  ', newPassword: '  replacement passphrase  ' };
  assert.deepEqual(await authRequest('/api/auth/change-password', body, 'original-user'), { ok: true });
  assert.equal(request.headers['X-Annotation-Actor'], 'original-user');
  assert.equal(request.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(request.body), body);
});

test('a rejected password request surfaces only the server error', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: 'Account changed. Sign in again.', code: 'SESSION_ACCOUNT_MISMATCH' }), { status: 409 }));
  await assert.rejects(authRequest('/api/auth/change-password', { currentPassword: 'sensitive', newPassword: 'also-sensitive' }, 'original-user'), /Account changed\. Sign in again\./);
});
