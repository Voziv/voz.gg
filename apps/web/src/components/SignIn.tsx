import { useState } from 'react';
import { authClient } from '../lib/auth-client';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const social = (provider: 'discord' | 'google') =>
    authClient.signIn.social({ provider, callbackURL: '/dashboard' });

  const magicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    await authClient.signIn.magicLink({ email, callbackURL: '/dashboard' });
    setSent(true);
  };

  return (
    <div className="flex flex-col gap-4 w-full max-w-sm">
      <button onClick={() => social('discord')} className="rounded bg-[#5865F2] py-2 font-semibold">
        Continue with Discord
      </button>
      <button onClick={() => social('google')} className="rounded bg-white text-black py-2 font-semibold">
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
        <button type="submit" className="rounded border border-primary text-primary py-2">
          Email me a magic link
        </button>
      </form>
      {sent && <p className="text-success text-sm">Check your email for a sign-in link.</p>}
    </div>
  );
}
