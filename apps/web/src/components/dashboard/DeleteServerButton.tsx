import { useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '../ui/button';

type Props = { id: string; name: string };

export default function DeleteServerButton({ id, name }: Props) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (!confirm(`Delete server "${name}"?`)) return;
    setPending(true);
    const res = await fetch(`/api/servers/${id}`, { method: 'DELETE' });
    const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
    setPending(false);
    if (r.ok) {
      toast.success('Server deleted.');
      location.reload();
    } else {
      toast.error('Could not delete server.');
    }
  }

  return (
    <Button type="button" variant="ghost" size="icon" aria-label={`Delete ${name}`} disabled={pending} onClick={handleClick}>
      <Trash2 size={16} />
    </Button>
  );
}
