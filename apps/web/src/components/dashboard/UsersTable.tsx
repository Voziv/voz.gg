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
import { rowActionAvailability, type GuardContext } from '../../lib/user-admin-guards';

export type AdminUserRole = 'user' | 'admin' | 'owner';

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  role: AdminUserRole;
  banned: boolean;
  banReason: string | null;
  minecraftName: string | null;
  steamPersona: string | null;
  createdAt: number;
};

type Props = {
  users: AdminUserRow[];
  actor: { id: string; role: AdminUserRole };
};

const ROLE_STYLES: Record<AdminUserRole, string> = {
  owner: 'bg-primary/15 text-primary',
  admin: 'bg-success/15 text-success',
  user: 'bg-muted text-muted-foreground',
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


function BanDialog({
  user,
  onDone,
  pending,
  setPending,
}: {
  user: AdminUserRow;
  onDone: () => void;
  pending: boolean;
  setPending: (value: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get('reason') ?? '');
    setPending(true);
    try {
      if (await post(`/api/admin/users/${user.id}/ban`, { reason })) {
        toast.success(`${user.email} banned.`);
        onDone();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        disabled={pending}
        className={cn(buttonVariants({ variant: 'destructive', size: 'sm' }), pending && 'pointer-events-none opacity-50')}
      >Ban</DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Ban {user.email}</DialogTitle>
            <DialogDescription>Record a reason. The user is signed out immediately.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5 py-4">
            <Label htmlFor={`reason-${user.id}`}>Reason</Label>
            <Input id={`reason-${user.id}`} name="reason" maxLength={500} required />
          </div>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? 'Banning…' : 'Ban user'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RowActions({ actor, user, reload }: { actor: Props['actor']; user: AdminUserRow; reload: () => void }) {
  const [pending, setPending] = useState(false);

  async function run(action: string, confirmText: string, body?: unknown) {
    if (!confirm(confirmText)) return;
    setPending(true);
    try {
      if (await post(`/api/admin/users/${user.id}/${action}`, body)) {
        toast.success('Done.');
        reload();
      }
    } finally {
      setPending(false);
    }
  }

  if (user.role === 'owner') {
    return <span className="text-xs text-muted-foreground">Owner (locked)</span>;
  }

  const guardCtx: GuardContext = { actorRole: actor.role, actorId: actor.id, targetRole: user.role, targetId: user.id };
  const actions = rowActionAvailability(guardCtx);

  if (!actions.any) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex justify-end gap-2">
      {user.banned
        ? actions.unban && (
            <Button type="button" size="sm" variant="outline" disabled={pending}
              onClick={() => run('unban', `Unban ${user.email}?`)}>Unban</Button>
          )
        : actions.ban && (
            <BanDialog user={user} onDone={reload} pending={pending} setPending={setPending} />
          )}
      {actions.revokeSessions && (
        <Button type="button" size="sm" variant="ghost" disabled={pending}
          onClick={() => run('revoke-sessions', `Sign ${user.email} out of all sessions?`)}>Sign out</Button>
      )}
      {actions.makeAdmin && (
        <Button type="button" size="sm" variant="outline" disabled={pending}
          onClick={() => run('set-role', `Make ${user.email} an admin?`, { role: 'admin' })}>Make admin</Button>
      )}
      {actions.demote && (
        <Button type="button" size="sm" variant="outline" disabled={pending}
          onClick={() => run('set-role', `Demote ${user.email} to a regular user?`, { role: 'user' })}>Demote</Button>
      )}
      {actions.transferOwnership && (
        <Button type="button" size="sm" variant="outline" disabled={pending}
          onClick={() => run('transfer-ownership', `Transfer ownership to ${user.email}? You will become an admin.`)}>Make owner</Button>
      )}
      {actions.delete && (
        <Button type="button" size="sm" variant="destructive" disabled={pending}
          onClick={() => run('delete', `Permanently delete ${user.email}? This cannot be undone.`)}>Delete</Button>
      )}
    </div>
  );
}

export default function UsersTable({ users, actor }: Props) {
  // Reloading re-runs the page's server-side query, preserving the current
  // search and page after a row action.
  const reload = () => location.reload();

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Linked</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr className="border-t border-border" key={u.id}>
                <td className="px-4 py-3">
                  <div className="text-foreground">{u.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{u.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn('rounded px-2 py-0.5 text-xs font-medium', ROLE_STYLES[u.role])}>{u.role}</span>
                </td>
                <td className="px-4 py-3">
                  {u.banned ? (
                    <span className="rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">banned</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">active</span>
                  )}
                  {u.banned && u.banReason && <div className="mt-1 text-xs text-muted-foreground">{u.banReason}</div>}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {[u.minecraftName && `MC: ${u.minecraftName}`, u.steamPersona && `Steam: ${u.steamPersona}`]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <RowActions actor={actor} user={u} reload={reload} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
