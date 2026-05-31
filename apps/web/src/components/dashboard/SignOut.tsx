import { useState } from 'react';
import { authClient } from '../../lib/auth-client';
import { Button } from '../ui/button';

export default function SignOut() {
  const [pending, setPending] = useState(false);
  async function handleClick() {
    setPending(true);
    await authClient.signOut();
    location.href = '/';
  }
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={handleClick}>
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
