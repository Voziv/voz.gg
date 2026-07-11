import { useState, type JSX } from 'react';
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
import {
  GAME_TYPES, type GameType,
  UPDATE_SOURCES, type UpdateSource,
  MODPACK_PROVIDERS, type ModpackProvider,
  UPDATE_POLICIES, type UpdatePolicy,
} from '@voz/shared';
import { initialAgentHostValues, nextAgentHostValues, initialServerControlValues } from './server-form-defaults';
import { localTimeToUtc, utcTimeToLocal } from '../../lib/restart-time';
import type { ServerFormData } from '../../lib/server-form-data';

const GAME_LABELS: Record<GameType, string> = {
  'minecraft-java': 'Minecraft (Java)',
  'minecraft-bedrock': 'Minecraft (Bedrock)',
  source: 'Source engine',
  'generic-tcp': 'Generic TCP',
  unknown: 'Unknown / Other',
};

const UPDATE_SOURCE_LABELS: Record<UpdateSource, string> = {
  none: 'None',
  vanilla: 'Vanilla',
  forge: 'Forge',
  neoforge: 'NeoForge',
  fabric: 'Fabric',
  modpack: 'Modpack',
};

const MODPACK_PROVIDER_LABELS: Record<ModpackProvider, string> = {
  modrinth: 'Modrinth',
  curseforge: 'CurseForge',
  ftb: 'FTB',
  packwiz: 'packwiz',
};

const UPDATE_POLICY_LABELS: Record<UpdatePolicy, string> = {
  notify: 'Notify only',
  approve: 'Approve before update',
  auto: 'Auto-update',
};

function modpackIdLabel(provider: ModpackProvider): string {
  switch (provider) {
    case 'modrinth': return 'Modrinth project ID';
    case 'curseforge': return 'CurseForge mod ID';
    case 'ftb': return 'FTB pack ID';
    case 'packwiz': return 'pack.toml URL';
  }
}

function FieldError({ errors, field }: { errors: Record<string, string>; field: string }): JSX.Element | null {
  if (!errors[field]) return null;
  return <p className="text-destructive text-sm mt-1" role="alert">{errors[field]}</p>;
}

type Props = { server?: ServerFormData };

export default function ServerFormDialog({ server }: Props) {
  const isEdit = !!server;
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
            serverJvmArgs: server.serverJvmArgs,
            restartScheduleLocal: server.restartSchedule ? utcTimeToLocal(server.restartSchedule) : null,
          }
        : undefined,
    ),
  );

  const [updates, setUpdates] = useState<{
    updateSource: UpdateSource;
    modpackProvider: ModpackProvider;
    modpackId: string;
    updateVersionLine: string;
    updateChannel: string;
    pinnedVersion: string;
    currentVersion: string;
    updatePolicy: UpdatePolicy;
    majorUpdatePolicy: UpdatePolicy;
  }>({
    updateSource: server?.updateSource ?? 'none',
    modpackProvider: server?.modpackProvider ?? 'modrinth',
    modpackId: server?.modpackId ?? '',
    updateVersionLine: server?.updateVersionLine ?? '',
    updateChannel: server?.updateChannel === 'experimental' ? 'experimental' : 'stable',
    pinnedVersion: server?.pinnedVersion ?? '',
    currentVersion: server?.currentVersion ?? '',
    updatePolicy: server?.updatePolicy ?? 'notify',
    majorUpdatePolicy: (server?.majorUpdatePolicy as UpdatePolicy | null) ?? (server?.updateSource === 'vanilla' ? 'auto' : 'approve'),
  });

  function handleGameTypeChange(next: GameType) {
    setAgentHost((current) => nextAgentHostValues(gameType, next, current));
    setGameType(next);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldErrors({});
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
      serverJvmArgs: serverControl.serverJvmArgs.trim() || null,
      restartSchedule: serverControl.restartTime ? localTimeToUtc(serverControl.restartTime) : null,
      discordWebhookUrl: form.get('discordWebhookUrl'),
      updateSource: updates.updateSource,
      modpackProvider: updates.updateSource === 'modpack' ? updates.modpackProvider : null,
      modpackId: updates.updateSource === 'modpack' ? (updates.modpackId.trim() || null) : null,
      updateVersionLine: (updates.updateSource === 'forge' || updates.updateSource === 'neoforge') ? (updates.updateVersionLine.trim() || null) : null,
      updateChannel: updates.updateChannel,
      pinnedVersion: updates.pinnedVersion.trim() || null,
      updatePolicy: updates.updatePolicy,
      majorUpdatePolicy: updates.majorUpdatePolicy,
      currentVersion: updates.currentVersion.trim() || null,
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
        fieldErrors?: Record<string, string>;
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
        setFieldErrors(r.fieldErrors ?? {});
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
            <Input id="name" name="name" defaultValue={server?.name ?? ''} required maxLength={80} aria-invalid={!!fieldErrors.name} />
            <FieldError errors={fieldErrors} field="name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="gameType" className="text-muted-foreground">Game type</Label>
              <select
                id="gameType"
                name="gameType"
                value={gameType}
                onChange={(e) => handleGameTypeChange(e.target.value as GameType)}
                aria-invalid={!!fieldErrors.gameType}
                className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                {GAME_TYPES.map((g) => (
                  <option key={g} value={g}>{GAME_LABELS[g] ?? g}</option>
                ))}
              </select>
              <FieldError errors={fieldErrors} field="gameType" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="port" className="text-muted-foreground">Port</Label>
              <Input id="port" name="port" type="number" min={1} max={65535} defaultValue={server?.port ?? 25565} required aria-invalid={!!fieldErrors.port} />
              <FieldError errors={fieldErrors} field="port" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="host" className="text-muted-foreground">Host (IP or DNS name)</Label>
            <Input id="host" name="host" defaultValue={server?.host ?? ''} required maxLength={253} placeholder="mc.example.com" aria-invalid={!!fieldErrors.host} />
            <FieldError errors={fieldErrors} field="host" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="description" className="text-muted-foreground">Description</Label>
            <textarea
              id="description"
              name="description"
              defaultValue={server?.description ?? ''}
              maxLength={500}
              rows={3}
              aria-invalid={!!fieldErrors.description}
              className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
            />
            <FieldError errors={fieldErrors} field="description" />
          </div>

          <fieldset className="grid gap-4 rounded-md border border-border p-3">
            <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">Agent host</legend>
            <p className="text-xs text-muted-foreground">
              How the monitoring agent is installed on the host. Defaults suit most setups.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="runAsUser" className="text-muted-foreground">Run-as user</Label>
                <Input id="runAsUser" name="runAsUser" defaultValue={server?.runAsUser ?? 'voz-gg'} maxLength={32} aria-invalid={!!fieldErrors.runAsUser} />
                <FieldError errors={fieldErrors} field="runAsUser" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="runAsGroup" className="text-muted-foreground">Run-as group</Label>
                <Input id="runAsGroup" name="runAsGroup" defaultValue={server?.runAsGroup ?? 'voz-gg'} maxLength={32} aria-invalid={!!fieldErrors.runAsGroup} />
                <FieldError errors={fieldErrors} field="runAsGroup" />
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
                aria-invalid={!!fieldErrors.gameServerUser}
              />
              <FieldError errors={fieldErrors} field="gameServerUser" />
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
                aria-invalid={!!fieldErrors.logPath}
              />
              <FieldError errors={fieldErrors} field="logPath" />
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
              aria-invalid={!!fieldErrors.discordWebhookUrl}
            />
            <FieldError errors={fieldErrors} field="discordWebhookUrl" />
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
                aria-invalid={!!fieldErrors.serverWorkingDir}
              />
              <FieldError errors={fieldErrors} field="serverWorkingDir" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="startCommand">Start command (foreground; no self-restart loop)</Label>
              <Input
                id="startCommand"
                value={serverControl.startCommand}
                onChange={(e) => setServerControl((c) => ({ ...c, startCommand: e.target.value }))}
                placeholder="/home/minecraft/server/run.sh nogui"
                aria-invalid={!!fieldErrors.startCommand}
              />
              <FieldError errors={fieldErrors} field="startCommand" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="serverJvmArgs">JVM args (for loader launches)</Label>
              <Input
                id="serverJvmArgs"
                value={serverControl.serverJvmArgs}
                onChange={(e) => setServerControl((c) => ({ ...c, serverJvmArgs: e.target.value }))}
                placeholder="-Xmx4G"
                aria-invalid={!!fieldErrors.serverJvmArgs}
              />
              <FieldError errors={fieldErrors} field="serverJvmArgs" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="restartTime">Nightly restart time (your local time; blank = none)</Label>
              <Input
                id="restartTime"
                type="time"
                value={serverControl.restartTime}
                onChange={(e) => setServerControl((c) => ({ ...c, restartTime: e.target.value }))}
                aria-invalid={!!fieldErrors.restartSchedule}
              />
              <FieldError errors={fieldErrors} field="restartSchedule" />
            </div>
          </fieldset>

          <fieldset className="grid gap-4 rounded-md border border-border p-3">
            <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">Updates</legend>
            <div className="grid gap-2">
              <Label htmlFor="updateSource" className="text-muted-foreground">Update source</Label>
              <select
                id="updateSource"
                value={updates.updateSource}
                onChange={(e) => setUpdates((c) => ({ ...c, updateSource: e.target.value as UpdateSource }))}
                aria-invalid={!!fieldErrors.updateSource}
                className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                {UPDATE_SOURCES.map((s) => (
                  <option key={s} value={s}>{UPDATE_SOURCE_LABELS[s]}</option>
                ))}
              </select>
              <FieldError errors={fieldErrors} field="updateSource" />
            </div>
            {updates.updateSource === 'modpack' && (
              <>
                <div className="grid gap-2">
                  <Label htmlFor="modpackProvider" className="text-muted-foreground">Modpack provider</Label>
                  <select
                    id="modpackProvider"
                    value={updates.modpackProvider}
                    onChange={(e) => setUpdates((c) => ({ ...c, modpackProvider: e.target.value as ModpackProvider }))}
                    aria-invalid={!!fieldErrors.modpackProvider}
                    className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
                  >
                    {MODPACK_PROVIDERS.map((p) => (
                      <option key={p} value={p}>{MODPACK_PROVIDER_LABELS[p]}</option>
                    ))}
                  </select>
                  <FieldError errors={fieldErrors} field="modpackProvider" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="modpackId" className="text-muted-foreground">{modpackIdLabel(updates.modpackProvider)}</Label>
                  <Input
                    id="modpackId"
                    value={updates.modpackId}
                    onChange={(e) => setUpdates((c) => ({ ...c, modpackId: e.target.value }))}
                    aria-invalid={!!fieldErrors.modpackId}
                  />
                  <FieldError errors={fieldErrors} field="modpackId" />
                </div>
              </>
            )}
            {(updates.updateSource === 'forge' || updates.updateSource === 'neoforge') && (
              <div className="grid gap-2">
                <Label htmlFor="updateVersionLine" className="text-muted-foreground">
                  {updates.updateSource === 'forge' ? 'Minecraft version line' : 'NeoForge version line'}
                </Label>
                <Input
                  id="updateVersionLine"
                  value={updates.updateVersionLine}
                  onChange={(e) => setUpdates((c) => ({ ...c, updateVersionLine: e.target.value }))}
                  placeholder={updates.updateSource === 'forge' ? 'e.g. 1.21.1' : 'e.g. 21.1'}
                  aria-invalid={!!fieldErrors.updateVersionLine}
                />
                <FieldError errors={fieldErrors} field="updateVersionLine" />
                <p className="text-xs text-muted-foreground">
                  {updates.updateSource === 'forge'
                    ? 'Minecraft version line, e.g. 1.21.1'
                    : 'NeoForge version line, e.g. 21.1'}
                </p>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="updateChannel" className="text-muted-foreground">Release channel</Label>
              <select
                id="updateChannel"
                value={updates.updateChannel}
                onChange={(e) => setUpdates((c) => ({ ...c, updateChannel: e.target.value }))}
                className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                <option value="stable">Stable</option>
                <option value="experimental">Experimental (beta/snapshot)</option>
              </select>
              <FieldError errors={fieldErrors} field="updateChannel" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="currentVersion" className="text-muted-foreground">Current version</Label>
              <Input
                id="currentVersion"
                value={updates.currentVersion}
                onChange={(e) => setUpdates((c) => ({ ...c, currentVersion: e.target.value }))}
                aria-invalid={!!fieldErrors.currentVersion}
              />
              <FieldError errors={fieldErrors} field="currentVersion" />
              <p className="text-xs text-muted-foreground">What this server runs now. Becomes automatic once the agent reports it.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pinnedVersion" className="text-muted-foreground">Pinned version (optional)</Label>
              <Input
                id="pinnedVersion"
                value={updates.pinnedVersion}
                onChange={(e) => setUpdates((c) => ({ ...c, pinnedVersion: e.target.value }))}
                aria-invalid={!!fieldErrors.pinnedVersion}
              />
              <FieldError errors={fieldErrors} field="pinnedVersion" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="updatePolicy" className="text-muted-foreground">Update policy</Label>
              <select
                id="updatePolicy"
                value={updates.updatePolicy}
                onChange={(e) => setUpdates((c) => ({ ...c, updatePolicy: e.target.value as UpdatePolicy }))}
                aria-invalid={!!fieldErrors.updatePolicy}
                className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                {UPDATE_POLICIES.map((p) => (
                  <option key={p} value={p}>{UPDATE_POLICY_LABELS[p]}</option>
                ))}
              </select>
              <FieldError errors={fieldErrors} field="updatePolicy" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="majorUpdatePolicy" className="text-muted-foreground">Major-version updates</Label>
              <select
                id="majorUpdatePolicy"
                value={updates.majorUpdatePolicy}
                onChange={(e) => setUpdates((c) => ({ ...c, majorUpdatePolicy: e.target.value as UpdatePolicy }))}
                aria-invalid={!!fieldErrors.majorUpdatePolicy}
                className="rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                {UPDATE_POLICIES.map((p) => (
                  <option key={p} value={p}>{UPDATE_POLICY_LABELS[p]}</option>
                ))}
              </select>
              <FieldError errors={fieldErrors} field="majorUpdatePolicy" />
              <p className="text-xs text-muted-foreground">How to handle a Minecraft major (generation) jump. Auto applies it; Approve posts a Discord notice and waits for a button.</p>
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
