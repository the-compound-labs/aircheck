'use client';

import { useCallback, useEffect, useState } from 'react';
import { SignIn } from '@/components/SignIn';

/* The landing's sign-in. Signing in is this dialog, never a page: every "/?signin=1" link on the
 * landing opens it in place, and a redirect to sign in arrives as "/?signin=1" with it open. */
export function SignInLauncher({ open: initial, google, error, reset = '' }: { open: boolean; google: boolean; error: string; reset?: string }) {
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    const click = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.('a[href="/?signin=1"]');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      setOpen(true);
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    const l = window.location;
    if (l.pathname !== '/' || new URLSearchParams(l.search).has('signin')) window.history.replaceState(null, '', '/');
  }, []);
  return open ? <SignIn empty={false} google={google} error={error} onClose={close} canReset start={reset ? 'reset' : undefined} token={reset} /> : null;
}
