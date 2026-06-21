import { useState } from 'react';
import { toast } from 'sonner';
import { PLAYER_STATUSES, type PlayerStatus } from '@voz/shared';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/select';
import { Switch } from '../ui/switch';

type Props = {
  playerId: string;
  displayName: string | null;
  status: PlayerStatus;
  isBot: boolean;
  muted: boolean;
  notes: string | null;
};

export default function PlayerFieldsEditor({ playerId, displayName, status, isBot, muted, notes }: Props) {
  const [name, setName] = useState(displayName ?? '');
  const [statusValue, setStatusValue] = useState<PlayerStatus>(status);
  const [bot, setBot] = useState(isBot);
  const [mutedValue, setMutedValue] = useState(muted);
  const [notesValue, setNotesValue] = useState(notes ?? '');
  const [pending, setPending] = useState(false);

  async function handleSave() {
    setPending(true);
    try {
      const res = await fetch(`/api/players/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name, status: statusValue, isBot: bot, muted: mutedValue, notes: notesValue }),
      });
      const r = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (r.ok) {
        toast.success('Player updated.');
        location.reload();
      } else {
        toast.error(r.error ?? 'Could not update player.');
      }
    } catch {
      toast.error('Could not update player.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="player-name">Display name</Label>
        <Input id="player-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Unnamed" />
      </div>
      <div className="grid gap-2">
        <Label>Status</Label>
        <Select value={statusValue} onValueChange={(v) => setStatusValue(v as PlayerStatus)}>
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLAYER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={bot} onChange={(e) => setBot(e.target.checked)} />
        Marked as bot
      </label>
      <div className="flex items-center justify-between gap-2">
        <div className="grid gap-1">
          <Label htmlFor="muted">Muted</Label>
          <p className="text-xs text-muted-foreground">Silence routine alerts (escalation still fires).</p>
        </div>
        <Switch
          id="muted"
          checked={mutedValue}
          onCheckedChange={(checked) => setMutedValue(checked)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="player-notes">Notes</Label>
        <textarea
          id="player-notes"
          value={notesValue}
          onChange={(e) => setNotesValue(e.target.value)}
          rows={4}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div>
        <Button type="button" onClick={handleSave} disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  );
}
