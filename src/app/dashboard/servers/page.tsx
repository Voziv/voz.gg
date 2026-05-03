import { Plus, Pencil } from 'lucide-react';
import { db } from '@/db';
import { servers } from '@/db/schema';
import { requireUser, isAdmin } from '@/lib/auth';
import { checkServerStatus } from '@/lib/status';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/dashboard/status-badge';
import { ServerFormDialog } from '@/components/dashboard/server-form-dialog';
import { DeleteServerButton } from '@/components/dashboard/delete-server-button';

const GAME_LABELS: Record<string, string> = {
  'minecraft-java': 'Minecraft (Java)',
  'minecraft-bedrock': 'Minecraft (Bedrock)',
  source: 'Source',
  'generic-tcp': 'TCP',
  unknown: 'Unknown',
};

export default async function ServersPage() {
  const { auth, user } = await requireUser();
  const admin = isAdmin(auth, user);

  const all = db.select().from(servers).all();
  const statuses = await Promise.all(all.map((s) => checkServerStatus(s)));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Servers</h1>
          <p className="mt-1 text-white/40">
            Connection details and live status for community game servers.
          </p>
        </div>
        {admin && (
          <ServerFormDialog>
            <Plus size={16} />
            Add server
          </ServerFormDialog>
        )}
      </div>

      {all.length === 0 ? (
        <Card className="border-[#1a1a2e] bg-[#0d0d14]">
          <CardContent className="py-12 text-center text-white/40">
            No servers configured yet.
            {admin && ' Click "Add server" to create one.'}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#1a1a2e] bg-[#0d0d14]">
          <table className="w-full text-sm">
            <thead className="bg-[#0a0a0f] text-left text-xs uppercase tracking-wide text-white/40">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Game</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {admin && <th className="px-4 py-3 font-medium" aria-label="Actions" />}
              </tr>
            </thead>
            <tbody>
              {all.map((s, i) => (
                <tr key={s.id} className="border-t border-[#1a1a2e]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">{s.name}</div>
                    {s.description && (
                      <div className="text-xs text-white/40">{s.description}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-white/70">
                    {GAME_LABELS[s.gameType] ?? s.gameType}
                  </td>
                  <td className="px-4 py-3 font-mono text-white/70">
                    {s.host}:{s.port}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge result={statuses[i]} />
                  </td>
                  {admin && (
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <ServerFormDialog
                          server={s}
                          triggerVariant="ghost"
                          triggerSize="icon"
                          triggerAriaLabel={`Edit ${s.name}`}
                        >
                          <Pencil size={16} />
                        </ServerFormDialog>
                        <DeleteServerButton id={s.id} name={s.name} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
