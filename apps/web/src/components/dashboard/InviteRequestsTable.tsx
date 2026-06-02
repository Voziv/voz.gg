import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Button, buttonVariants } from '../ui/button';
import { cn } from '../../lib/utils';

type InviteStatus = 'pending' | 'approved' | 'denied';

type InviteRow = {
  id: string;
  name: string;
  discordName: string;
  email: string;
  status: InviteStatus;
  denyReason: string | null;
  createdAt: number;
};

type Props = { requests: InviteRow[] };

const STATUS_STYLES: Record<InviteStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  approved: 'bg-success/15 text-success',
  denied: 'bg-destructive/15 text-destructive',
};

async function post(url: string, body?: unknown): Promise<boolean> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const r = (await res.json().catch(() => ({ ok: false, error: 'Request failed.' }))) as {
    ok: boolean;
    error?: string;
  };
  if (!r.ok) toast.error(r.error ?? 'Action failed.');
  return r.ok;
}

function DenyDialog({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = new FormData(e.currentTarget).get('reason');
    setPending(true);
    try {
      if (await post(`/api/invite-requests/${id}/deny`, { reason })) {
        toast.success('Request denied.');
        location.reload();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={cn(buttonVariants({ variant: 'destructive', size: 'sm' }))}>Deny</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Deny {name}'s request</DialogTitle>
            <DialogDescription>Optionally record a reason. The requester is not notified.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5 py-4">
            <Label htmlFor={`reason-${id}`}>Reason (optional)</Label>
            <Input id={`reason-${id}`} name="reason" maxLength={500} />
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Denying…' : 'Deny request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ApproveButton({ id }: { id: string }) {
  const [pending, setPending] = useState(false);
  async function handleClick() {
    if (!confirm('Approve and email an invite link?')) return;
    setPending(true);
    try {
      if (await post(`/api/invite-requests/${id}/approve`)) {
        toast.success('Approved — invite emailed.');
        location.reload();
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <Button type="button" size="sm" disabled={pending} onClick={handleClick}>
      {pending ? 'Approving…' : 'Approve'}
    </Button>
  );
}

export default function InviteRequestsTable({ requests }: Props) {
  if (requests.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card py-12 text-center text-muted-foreground">
        No invite requests yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-4 py-3 font-medium">Discord</th>
            <th className="px-4 py-3 font-medium">Email</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr className="border-t border-border" key={r.id}>
              <td className="px-4 py-3 text-foreground">{r.name}</td>
              <td className="px-4 py-3 text-muted-foreground">{r.discordName}</td>
              <td className="px-4 py-3 font-mono text-muted-foreground">{r.email}</td>
              <td className="px-4 py-3">
                <span className={cn('rounded px-2 py-0.5 text-xs font-medium', STATUS_STYLES[r.status])}>
                  {r.status}
                </span>
                {r.status === 'denied' && r.denyReason && (
                  <div className="mt-1 text-xs text-muted-foreground">{r.denyReason}</div>
                )}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  {r.status === 'pending' && (
                    <>
                      <ApproveButton id={r.id} />
                      <DenyDialog id={r.id} name={r.name} />
                    </>
                  )}
                  {r.status === 'denied' && <ApproveButton id={r.id} />}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
