'use client';

import { useAuth } from '@workos-inc/authkit-nextjs/components';
import { Button } from '@/components/ui/button';

export function NavAuth() {
  const { user, loading, refreshAuth, signOut } = useAuth();

  if (loading) {
    return (
      <Button disabled className="mt-2 px-8">
        Loading...
      </Button>
    );
  }

  if (user) {
    return (
      <div className="flex flex-col items-center gap-4">
        <p className="text-sm text-white/60">
          Welcome, <span className="text-white">{user.firstName || user.email}</span>
        </p>
        <div className="flex gap-3">
          <Button render={<a href="/dashboard" />} nativeButton={false} className="px-8">
            Dashboard
          </Button>
          <Button
            variant="outline"
            className="px-8"
            onClick={() => void signOut()}
          >
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      className="mt-2 px-8"
      onClick={() => void refreshAuth({ ensureSignedIn: true })}
    >
      Sign In
    </Button>
  );
}
