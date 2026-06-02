import { useState } from 'react';
import { toast } from 'sonner';
import Turnstile from './Turnstile';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Button } from './ui/button';

export default function RequestInviteForm() {
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) {
      toast.error('Please complete the verification.');
      return;
    }
    const form = new FormData(e.currentTarget);
    const body = {
      name: form.get('name'),
      discordName: form.get('discordName'),
      email: form.get('email'),
      turnstileToken: token,
    };
    setPending(true);
    try {
      const res = await fetch('/api/invite-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (r.ok) {
        setDone(true);
      } else {
        toast.error(r.error ?? 'Could not submit your request.');
      }
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <p className="w-full max-w-sm rounded border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
        Thanks! Your request has been submitted. If you're approved, we'll email you an invite link.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required maxLength={80} autoComplete="name" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="discordName">Discord username</Label>
        <Input id="discordName" name="discordName" required maxLength={80} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" required maxLength={254} autoComplete="email" />
      </div>
      <Turnstile onVerify={setToken} onExpire={() => setToken('')} />
      <Button type="submit" disabled={pending || !token}>
        {pending ? 'Submitting…' : 'Request an invite'}
      </Button>
    </form>
  );
}
