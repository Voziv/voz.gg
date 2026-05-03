'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deleteServer } from '@/app/dashboard/servers/actions';

export function DeleteServerButton({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Delete ${name}`}
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete server "${name}"?`)) return;
        start(async () => {
          const r = await deleteServer(id);
          if (r.ok) toast.success(r.message ?? 'Deleted.');
          else toast.error(r.error);
        });
      }}
    >
      <Trash2 size={16} />
    </Button>
  );
}
