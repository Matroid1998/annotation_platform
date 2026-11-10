'use client';

import { useState, type ReactNode } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { authRequest, type AuthMode } from './client';

type Props = {
  onBeforeSignOut?: () => boolean;
  onSignedOut?: () => void;
  className?: string;
  children?: ReactNode;
  authMode?: AuthMode;
};

export default function SignOutButton({ onBeforeSignOut, onSignedOut, className, children, authMode = 'local' }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    if (pending || (onBeforeSignOut && !onBeforeSignOut())) return;
    setPending(true); setError('');
    try {
      await authRequest('/api/auth/logout', {});
      // Recovery drafts belong to the account and must survive sign-out.
      onSignedOut?.();
      await new Promise(resolve => setTimeout(resolve, 0));
      window.location.replace('/login');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign-out could not be confirmed. Please try again.');
      setPending(false);
    }
  }

  if (authMode === 'chatgpt') return <a className={className || 'auth-sign-out'} href="/signout-with-chatgpt?return_to=/login" onClick={event => { if (onBeforeSignOut && !onBeforeSignOut()) event.preventDefault(); }} aria-label={children ? undefined : 'Sign out'} title="Sign out">{children || <LogOut size={17} />}</a>;

  return <span className="auth-sign-out-wrap"><button type="button" className={className || 'auth-sign-out'} onClick={() => void signOut()} disabled={pending} aria-label={children ? undefined : 'Sign out'} title="Sign out">{pending ? <Loader2 size={16} className="spin" /> : children || <LogOut size={17} />}</button>{error && <span className="auth-sign-out-error" role="alert">{error}</span>}</span>;
}
