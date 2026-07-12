import { useState } from 'react';
import { updateActionsViewModel, type UpdateActionsInput } from '../../lib/update-actions-view';
import { Button } from '../ui/button';

type Props = UpdateActionsInput & {
  serverId: string;
  events: Array<{ at: string; kind: string; fromVersion: string | null; toVersion: string | null; status: string; error: string | null }>;
};

export default function UpdateActions(props: Props) {
  const vm = updateActionsViewModel(props);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState(props.snapshots[0]?.snapshotId ?? '');

  async function post(path: string, body?: unknown) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || data.ok === false) {
        setError(data.error ?? 'Action failed.');
        return;
      }
      location.reload();
    } finally {
      setPending(false);
    }
  }

  if (!vm.showApprove && !vm.showRollback && !vm.showMajorUpgrade && props.events.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {vm.showApprove && (
        <Button disabled={pending} onClick={() => post(`/api/servers/${props.serverId}/update/approve`)}>
          Apply update → {props.availableVersion}
        </Button>
      )}
      {vm.showMajorUpgrade && (
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() => {
            if (confirm(`${vm.majorLabel}? This is a major version jump and may affect mods/worlds.`)) {
              post(`/api/servers/${props.serverId}/update/approve-major`);
            }
          }}
        >
          {vm.majorLabel}
        </Button>
      )}
      {vm.showRollback && (
        <div className="flex items-center gap-2">
          <select
            className="rounded border bg-background px-2 py-1 text-sm"
            value={snapshot}
            onChange={(e) => setSnapshot(e.target.value)}
          >
            {props.snapshots.map((s) => (
              <option key={s.snapshotId} value={s.snapshotId}>
                {s.version ?? s.snapshotId} ({new Date(s.createdAt).toLocaleString()})
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            disabled={pending || !snapshot}
            onClick={() => {
              if (confirm('Roll back to this snapshot?')) {
                post(`/api/servers/${props.serverId}/update/rollback`, { snapshotId: snapshot });
              }
            }}
          >
            Roll back
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {props.events.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary>Update history</summary>
          <ul className="mt-1 space-y-1">
            {props.events.map((e, i) => (
              <li key={i}>
                {new Date(e.at).toLocaleString()} — {e.kind} {e.fromVersion ?? '?'}→{e.toVersion ?? '?'} ({e.status})
                {e.error ? `: ${e.error}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
