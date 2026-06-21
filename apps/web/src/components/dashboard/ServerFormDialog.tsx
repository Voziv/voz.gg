import { useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Plus } from 'lucide-react';
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
import { Switch } from '../ui/switch';
import { cn } from '../../lib/utils';
import { GAME_TYPES, type GameType } from '@voz/shared';
import { initialAgentHostValues, nextAgentHostValues, initialServerControlValues } from './server-form-defaults';
import { localTimeToUtc, utcTimeToLocal } from '../../lib/restart-time';

const GAME_LABELS: Record<GameType, string> = {
  'minecraft-java': 'Minecraft (Java)',
  'minecraft-bedrock': 'Minecraft (Bedrock)',
  source: 'Source engine',
  'generic-tcp': 'Generic TCP',
  unknown: 'Unknown / Other',
};

type ServerData = {
  id: string;
  name: string;
  gameType: GameType;
  host: string;
  port: number;
  description: string | null;
  runAsUser: string | null;
  runAsGroup: string | null;
  gameServerUser: string | null;
  logPath: string | null;
  logParserEnabled: boolean | null;
  discordWebhookUrl: string | null;
  slug: string | null;
  serverControlEnabled: boolean | null;
  serverWorkingDir: string | null;
  startCommand: string | null;
  restartSchedule: string | null;
};
type Props = { server?: ServerData };

export default function ServerFormDialog({ server }: Props) {
  const isEdit = !!server;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const [gameType, setGameType] = useState<GameType>(server?.gameType ?? 'minecraft-java');
  const [agentHost, setAgentHost] = useState(() =>
    initialAgentHostValues(server?.gameType ?? 'minecraft-java', {
      gameServerUser: server?.gameServerUser,
      logPath: server?.logPath,
      logParserEnabled: server?.logParserEnabled,
    }),
  );
  const [serverControl, setServerControl] = useState(() =>
    initialServerControlValues(
      server
        ? {
            serverControlEnabled: server.serverControlEnabled,
            serverWorkingDir: server.serverWorkingDir,
            startCommand: server.startCommand,
            restartScheduleLocal: server.restartSchedule ? utcTimeToLocal(server.restartSchedule) : null,
          }
        : undefined,
    ),
  );

  function handleGameTypeChange(next: GameType) {
    setAgentHost((current) => nextAgentHostValues(gameType, next, current));
    setGameType(next);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = {
      name: form.get('name'),
      gameType: form.get('gameType'),
      host: form.get('host'),
      port: form.get('port'),
      description: form.get('description'),
      runAsUser: form.get('runAsUser'),
      runAsGroup: form.get('runAsGroup'),
      gameServerUser: form.get('gameServerUser'),
      logPath: form.get('logPath'),
      logParserEnabled: agentHost.logParserEnabled,
      serverControlEnabled: serverControl.serverControlEnabled,
      serverWorkingDir: serverControl.serverWorkingDir.trim() || null,
      startCommand: serverControl.startCommand.trim() || null,
      restartSchedule: serverControl.restartTime ? localTimeToUtc(serverControl.restartTime) : null,
      discordWebhookUrl: form.get('discordWebhookUrl'),
    };
    setPending(true);
    try {
      const res = await fetch(server ? `/api/servers/${server.id}` : '/api/servers', {
        method: server ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const r = (await res.json().catch(() => ({ ok: false }))) as {
        ok: boolean;
        error?: string;
        enrollmentToken?: string;
      };
      if (r.ok) {
        if (!isEdit && r.enrollmentToken) {
          const command = `curl -fsSL ${location.origin}/install-agent.sh | sudo sh -s -- ${r.enrollmentToken}`;
          await navigator.clipboard?.writeText(command).catch(() => undefined);
          toast.success('Server created. Install command copied — paste it on the host.', { duration: 8000 });
        } else {
          toast.success(isEdit ? 'Server updated.' : 'Server created.');
        }
        setOpen(false);
        location.reload();
      } else {
        toast.error(r.error ?? 'Could not save server.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label={server ? `Edit ${server.name}` : undefined}
        className={cn(buttonVariants(isEdit ? { variant: 'ghost', size: 'icon' } : {}))}
      >
        {isEdit ? (
          <Pencil size={16} />
        ) : (
          <>
            <Plus size={16} />
            Add server
          </>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit server' : 'Add server'}</DialogTitle>
          <DialogDescription>
            Connection details and game type are visible to all signed-in users.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4 overflow-hidden">
          <div className="grid min-h-0 gap-4 overflow-y-auto px-1 -mx-1">
          <div className="grid gap-2">
            <Label htmlFor="name" className="text-muted-foreground">Name</Label>
            <Input id="name" name="name" defaultValue={server?.name ?? ''} required maxLength={80} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="gameType" className="text-muted-foreground">Game type</Label>
              <select
                id="gameType"
                name="gameType"
                value={gameType}
                onChange={(e) => handleGameTypeChange(e.target.value as GameType)}
                className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                {GAME_TYPES.map((g) => (
                  <option key={g} value={g}>{GAME_LABELS[g] ?? g}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="port" className="text-muted-foreground">Port</Label>
              <Input id="port" name="port" type="number" min={1} max={65535} defaultValue={server?.port ?? 25565} required />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="host" className="text-muted-foreground">Host (IP or DNS name)</Label>
            <Input id="host" name="host" defaultValue={server?.host ?? ''} required maxLength={253} placeholder="mc.example.com" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description" className="text-muted-foreground">Description</Label>
            <textarea
              id="description"
              name="description"
              defaultValue={server?.description ?? ''}
              maxLength={500}
              rows={3}
              className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
            />
          </div>

          <fieldset className="grid gap-4 rounded-md border border-border p-3">
            <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">Agent host</legend>
            <p className="text-xs text-muted-foreground">
              How the monitoring agent is installed on the host. Defaults suit most setups.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="runAsUser" className="text-muted-foreground">Run-as user</Label>
                <Input id="runAsUser" name="runAsUser" defaultValue={server?.runAsUser ?? 'voz-gg'} maxLength={32} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="runAsGroup" className="text-muted-foreground">Run-as group</Label>
                <Input id="runAsGroup" name="runAsGroup" defaultValue={server?.runAsGroup ?? 'voz-gg'} maxLength={32} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="gameServerUser" className="text-muted-foreground">Game-server user</Label>
              <Input
                id="gameServerUser"
                name="gameServerUser"
                value={agentHost.gameServerUser}
                onChange={(e) => setAgentHost((c) => ({ ...c, gameServerUser: e.target.value }))}
                maxLength={32}
                placeholder="(none)"
              />
              <p className="text-xs text-muted-foreground">The OS account the game server runs under. Used by future log parsing.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="logPath" className="text-muted-foreground">Log path</Label>
              <Input
                id="logPath"
                name="logPath"
                value={agentHost.logPath}
                onChange={(e) => setAgentHost((c) => ({ ...c, logPath: e.target.value }))}
                maxLength={4096}
                placeholder="/home/minecraft/logs"
              />
              <p className="text-xs text-muted-foreground">Where the agent reads the server log when log parsing is enabled.</p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="grid gap-1">
                <Label htmlFor="logParserEnabled" className="text-muted-foreground">Enable log parsing</Label>
                <p className="text-xs text-muted-foreground">Tail the server log to track player join/leave and presence.</p>
              </div>
              <Switch
                id="logParserEnabled"
                checked={agentHost.logParserEnabled}
                onCheckedChange={(checked) => setAgentHost((c) => ({ ...c, logParserEnabled: checked }))}
              />
            </div>
            {isEdit && (
              <div className="grid gap-1 rounded-md bg-muted/50 p-2">
                <p className="text-xs text-muted-foreground">
                  After saving agent-host changes, apply them on the host (no re-enroll or new token
                  needed):
                </p>
                <code className="rounded bg-background px-2 py-1 font-mono text-xs select-all">
                  sudo voz-gg-agent reprovision
                </code>
              </div>
            )}
          </fieldset>

          <div className="grid gap-2">
            <Label htmlFor="discordWebhookUrl" className="text-muted-foreground">Discord webhook URL</Label>
            <Input
              id="discordWebhookUrl"
              name="discordWebhookUrl"
              type="url"
              defaultValue={server?.discordWebhookUrl ?? ''}
              maxLength={200}
              placeholder="https://discord.com/api/webhooks/..."
            />
            <p className="text-xs text-muted-foreground">Presence alerts post here. Leave blank to disable.</p>
          </div>

          <fieldset className="space-y-4">
            <legend className="text-sm font-medium">Server management</legend>
            <div className="flex items-center gap-2">
              <Switch
                id="serverControlEnabled"
                checked={serverControl.serverControlEnabled}
                onCheckedChange={(checked) => setServerControl((c) => ({ ...c, serverControlEnabled: checked }))}
              />
              <Label htmlFor="serverControlEnabled">Enable server management (systemd + RCON)</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="serverWorkingDir">Working directory</Label>
              <Input
                id="serverWorkingDir"
                value={serverControl.serverWorkingDir}
                onChange={(e) => setServerControl((c) => ({ ...c, serverWorkingDir: e.target.value }))}
                placeholder="/home/minecraft/server"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="startCommand">Start command (foreground; no self-restart loop)</Label>
              <Input
                id="startCommand"
                value={serverControl.startCommand}
                onChange={(e) => setServerControl((c) => ({ ...c, startCommand: e.target.value }))}
                placeholder="./run.sh nogui"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="restartTime">Nightly restart time (your local time; blank = none)</Label>
              <Input
                id="restartTime"
                type="time"
                value={serverControl.restartTime}
                onChange={(e) => setServerControl((c) => ({ ...c, restartTime: e.target.value }))}
              />
            </div>
          </fieldset>
          </div>

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : isEdit ? 'Save changes' : 'Create server'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
