import { useState } from 'react';
import { toast } from 'sonner';
import { authClient } from '../lib/auth-client';
import Turnstile from './Turnstile';

type Props = { error?: string | null };

export default function SignIn({ error }: Props) {
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  const social = (provider: 'discord' | 'google') =>
    authClient.signIn.social({
      provider,
      callbackURL: '/dashboard',
      errorCallbackURL: '/sign-in?error=no_invite',
    });

  const magicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setPending(true);
    try {
      const result = await authClient.signIn.magicLink(
        { email, callbackURL: '/dashboard', errorCallbackURL: '/sign-in?error=no_invite' },
        { headers: { 'x-captcha-response': token } },
      );
      if (result?.error) {
        toast.error(result.error.message ?? 'Could not send the sign-in link. Please try again.');
        return;
      }
      setSent(true);
    } catch {
      toast.error('Could not send the sign-in link. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-sm">
      {error && (
        <p
          role="alert"
          className="rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          No invite found for this email.{' '}
          <a className="underline" href="/request-invite">Request one</a>.
        </p>
      )}
      <button onClick={() => social('discord')} className="rounded bg-[#5865F2] py-2 font-semibold text-white hover:bg-[#4752c4]">
        Continue with Discord
      </button>
      <button onClick={() => social('google')} className="rounded border border-black/15 bg-white py-2 font-semibold text-black hover:bg-[#f5f5f5]">
        Continue with Google
      </button>
      <form onSubmit={magicLink} className="flex flex-col gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="rounded bg-muted px-3 py-2"
        />
        <Turnstile onVerify={setToken} onExpire={() => setToken('')} />
        <button
          type="submit"
          disabled={pending || !token}
          className="rounded border border-primary text-primary py-2 disabled:opacity-50"
        >
          Email me a magic link
        </button>
      </form>
      {sent && <p className="text-success text-sm">Check your email for a sign-in link.</p>}
      <a href="/request-invite" className="text-center text-sm text-muted-foreground hover:text-foreground">
        Need an invite? Request one
      </a>
    </div>
  );
}
