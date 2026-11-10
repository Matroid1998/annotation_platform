'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Mail } from 'lucide-react';
import AuthShell from './auth-shell';
import SignOutButton from './sign-out-button';
import { accountDestination, authRequest, safeReturnPath, type AuthResult, type AuthSession } from './client';

export default function LoginForm() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const returnTo = useRef<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    returnTo.current = new URLSearchParams(window.location.search).get('return_to');
    let active = true;
    authRequest<AuthSession>('/api/session').then(current => {
      if (!active) return;
      setSession(current);
      if (current.user && new URLSearchParams(window.location.search).get('switch_account') !== '1') { window.location.replace(accountDestination(current, returnTo.current)); return; }
      setChecking(false);
    }).catch(failure => {
      if (!active) return;
      setError(failure instanceof Error ? failure.message : 'The sign-in service is unavailable. Please try again.');
      setChecking(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || checking) return;
    setPending(true); setError('');
    try {
      const result = await authRequest<AuthResult>('/api/auth/login', { email: email.trim(), password });
      if (!result.user?.id || typeof result.isAdmin !== 'boolean' || typeof result.mustChangePassword !== 'boolean') throw new Error('The server did not confirm your sign-in. Please try again.');
      setPassword('');
      window.location.replace(accountDestination(result, returnTo.current));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign-in failed. Please try again.');
      setPending(false);
    }
  }

  return <AuthShell><div className="auth-form-card"><span className="auth-form-symbol"><KeyRound size={23} strokeWidth={1.5} /></span><span className="eyebrow">YOUR RESEARCH WORKSPACE</span><h2>Welcome back.</h2><p className="auth-form-intro">Sign in with the account provided by your administrator.</p>
    {error && <div className="auth-error" role="alert" ref={errorRef} tabIndex={-1}>{error}</div>}
    {checking ? <div className="auth-checking" role="status"><Loader2 className="spin" size={21} /><span>Checking your session…</span></div> : session?.user ? <div className="auth-switch-account"><p>You’re currently signed in as <strong>{session.user.email}</strong>.</p><a className="button auth-submit" href={accountDestination(session, returnTo.current)}>Continue with this account <ArrowRight size={16} /></a><SignOutButton authMode={session.authMode} className="button button-secondary auth-switch-button">Sign out and use another account</SignOutButton></div> : session?.authMode === 'chatgpt' ? <div className="auth-hosted"><p>This workspace uses ChatGPT sign-in.</p><a className="button auth-submit" href={`/signin-with-chatgpt?return_to=${encodeURIComponent(safeReturnPath(returnTo.current))}`} target="_top">Sign in with ChatGPT <ArrowRight size={17} /></a></div> : <form onSubmit={submit} className="auth-form">
      <div className="auth-field"><label htmlFor="login-email">Email address</label><div className="auth-input-wrap"><Mail size={17} /><input id="login-email" name="email" type="email" autoComplete="username" inputMode="email" placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)} required disabled={pending} maxLength={320} autoCapitalize="none" spellCheck={false} /></div></div>
      <div className="auth-field"><label htmlFor="login-password">Password</label><div className="auth-input-wrap"><KeyRound size={17} /><input id="login-password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={event => setPassword(event.target.value)} required disabled={pending} maxLength={1024} /><button className="auth-password-toggle" type="button" onClick={() => setVisible(!visible)} disabled={pending} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></div>
      <button className="button auth-submit" type="submit" disabled={pending}>{pending ? <Loader2 className="spin" size={17} /> : <ArrowRight size={17} />}{pending ? 'Signing in…' : 'Sign in'}</button>
    </form>}
    <div className="auth-support"><strong>Need access or a password reset?</strong><p>Contact your project administrator. Accounts and project assignments are managed by your research team.</p></div>
    <a className="auth-demo-link" href="/?demo=1">Explore the sample workspace <ArrowRight size={14} /></a>
  </div></AuthShell>;
}
