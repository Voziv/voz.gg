'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { updateProfile } from '@/app/dashboard/profile/actions';

type Props = {
  defaultDisplayName: string;
  defaultBio: string;
};

export function ProfileForm({ defaultDisplayName, defaultBio }: Props) {
  const [pending, start] = useTransition();

  function handleSave(formData: FormData) {
    start(async () => {
      const r = await updateProfile(null, formData);
      if (r.ok) toast.success(r.message ?? 'Saved.');
      else toast.error(r.error);
    });
  }

  return (
    <form action={handleSave} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="displayName" className="text-white/70">
          Display name
        </Label>
        <Input
          id="displayName"
          name="displayName"
          defaultValue={defaultDisplayName}
          maxLength={80}
          placeholder="How should we address you?"
          className="bg-[#0a0a0f] text-white"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="bio" className="text-white/70">
          Bio
        </Label>
        <textarea
          id="bio"
          name="bio"
          defaultValue={defaultBio}
          maxLength={500}
          rows={4}
          placeholder="A short blurb about you."
          className="rounded-md border border-input bg-[#0a0a0f] px-3 py-2 text-sm text-white outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        />
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save profile'}
        </Button>
      </div>
    </form>
  );
}
