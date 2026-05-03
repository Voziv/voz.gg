'use client';

import { useAuth } from '@workos-inc/authkit-nextjs/components';
import { Button } from '@/components/ui/button';

export function UserChip() {
  const { user, signOut } = useAuth();
  if (!user) return null;
  const label = user.firstName || user.email;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-white/60">{label}</span>
      <Button variant="ghost" size="sm" onClick={() => void signOut()}>
        Sign out
      </Button>
    </div>
  );
}
