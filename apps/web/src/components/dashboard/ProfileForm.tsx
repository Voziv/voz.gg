import { useState } from 'react';
import { toast } from 'sonner';
import { authClient } from '../../lib/auth-client';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button } from '../ui/button';

type Props = { defaultDisplayName: string; defaultBio: string };

export default function ProfileForm({ defaultDisplayName, defaultBio }: Props) {
  const [displayName, setDisplayName] = useState(defaultDisplayName);
  const [bio, setBio] = useState(defaultBio);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const { error } = await authClient.updateUser({ displayName, bio });
    setPending(false);
    if (error) toast.error(error.message ?? 'Could not save profile.');
    else toast.success('Profile saved.');
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="displayName" className="text-muted-foreground">Display name</Label>
        <Input
          id="displayName"
          value={displayName}
          maxLength={80}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="How should we address you?"
          className="bg-background text-foreground"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="bio" className="text-muted-foreground">Bio</Label>
        <textarea
          id="bio"
          value={bio}
          maxLength={500}
          rows={4}
          onChange={(e) => setBio(e.target.value)}
          placeholder="A short blurb about you."
          className="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>
      <div>
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</Button>
      </div>
    </form>
  );
}
