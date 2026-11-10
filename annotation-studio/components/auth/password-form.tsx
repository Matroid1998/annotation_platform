'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import AuthShell from './auth-shell';
import SignOutButton from './sign-out-button';
import { accountDestination, authRequest, type AuthResult, type AuthSession } from './client';

export default function PasswordForm() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [pending, setPending] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [destination, setDestination] = useState('/');
  const returnTo = useRef<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    returnTo.current = new URLSearchParams(window.location.search).get('return_to');
    let active = true;
    authRequest<AuthSession>('/api/session').then(current => {
      if (!active) return;
      if (!current.user) { window.location.replace('/login?return_to=%2Faccount%2Fpassword'); return; }
      setSession(current); setChecking(false);
    }).catch(failure => {
      if (!active) return;
      setError(failure instanceof Error ? failure.message : 'Your session could not be checked. Please sign in again.'); setChecking(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !session?.user) return;
    if ([...newPassword].length < 12 || [...newPassword].length > 128) { setError('Use a new password between 12 and 128 characters.'); return; }
    if (newPassword !== confirmation) { setError('The new password and confirmation do not match.'); return; }
    if (newPassword === currentPassword) { setError('Choose a new password that is different from your current password.'); return; }
    setPending(true); setError('');
    try {
      const result = await authRequest<AuthResult>('/api/auth/change-password', { currentPassword, newPassword }, session.user.id);
      if (!result.user?.id || typeof result.isAdmin !== 'boolean' || result.mustChangePassword !== false) throw new Error('The server has not confirmed the password change. Please try signing in with your new password to check your account.');
      setCurrentPassword(''); setNewPassword(''); setConfirmation('');
      const next = accountDestination(result, returnTo.current);
      setDestination(next); setComplete(true);
      window.location.replace(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The password change could not be confirmed. Please try again.'); setPending(false);
    }
  }

  const needsChange = !!session?.mustChangePassword;
  return <AuthShell><div className="auth-form-card auth-password-card"><span className="auth-form-symbol"><ShieldCheck size={24} strokeWidth={1.5} /></span><span className="eyebrow">ACCOUNT SECURITY</span><h2>{needsChange ? 'Make this account yours.' : 'Change your password.'}</h2><p className="auth-form-intro">{needsChange ? 'Replace your temporary password before accessing your workspace.' : 'Choose a new password for your Annotation Studio account.'}</p>
    {session?.user && <p className="auth-account-email">{session.user.email}<span>{session.isAdmin ? 'Administrator' : 'Annotator'}</span></p>}
    {error && <div className="auth-error" role="alert" ref={errorRef} tabIndex={-1}>{error}</div>}
    {checking ? <div className="auth-checking" role="status"><Loader2 className="spin" size={21} /><span>Checking your account…</span></div> : complete ? <div className="auth-success" role="status"><Check size={22} /><p>Your password has been changed.</p><a className="button auth-submit" href={destination}>Continue to your workspace <ArrowRight size={16} /></a></div> : session?.authMode === 'chatgpt' ? <div className="auth-hosted"><p>Your password is managed by your ChatGPT account.</p><a className="button auth-submit" href={session.isAdmin ? '/admin' : '/'}>Return to your workspace <ArrowRight size={16} /></a></div> : session?.user ? <form className="auth-form" onSubmit={submit}>
      <input type="text" name="username" autoComplete="username" value={session.user.email} readOnly className="auth-username-hidden" tabIndex={-1} aria-hidden="true" />
      <div className="auth-field"><label htmlFor="current-password">Current password</label><div className="auth-input-wrap"><KeyRound size={17} /><input id="current-password" name="currentPassword" type={visible ? 'text' : 'password'} autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required disabled={pending} maxLength={1024} placeholder={needsChange ? 'Enter your temporary password' : 'Enter your current password'} /></div></div>
      <div className="auth-field"><label htmlFor="new-password">New password</label><div className="auth-input-wrap"><KeyRound size={17} /><input id="new-password" name="newPassword" type={visible ? 'text' : 'password'} autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} required minLength={12} maxLength={256} disabled={pending} placeholder="At least 12 characters" aria-describedby="password-length-help" /></div><small id="password-length-help">Use 12–128 characters. A long, unique passphrase works well.</small></div>
      <div className="auth-field"><label htmlFor="confirm-password">Confirm new password</label><div className="auth-input-wrap"><KeyRound size={17} /><input id="confirm-password" name="confirmation" type={visible ? 'text' : 'password'} autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required minLength={12} maxLength={256} disabled={pending} placeholder="Enter the new password again" /></div></div>
      <button className="auth-show-passwords" type="button" onClick={() => setVisible(!visible)} disabled={pending} aria-pressed={visible}>{visible ? <EyeOff size={15} /> : <Eye size={15} />}{visible ? 'Hide passwords' : 'Show passwords'}</button>
      <button className="button auth-submit" type="submit" disabled={pending}>{pending ? <Loader2 size={17} className="spin" /> : <Check size={17} />}{pending ? 'Updating password…' : 'Save new password'}</button>
    </form> : <a className="button auth-submit" href="/login">Return to sign in <ArrowRight size={16} /></a>}
    {session?.user && !complete && <div className="auth-account-actions">{!needsChange && <a href={session.isAdmin ? '/admin' : '/'}><ArrowLeft size={14} />Back to workspace</a>}<SignOutButton authMode={session.authMode} className="auth-text-sign-out">Sign out</SignOutButton></div>}
  </div></AuthShell>;
}
