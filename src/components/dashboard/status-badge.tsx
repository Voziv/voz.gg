import { Badge } from '@/components/ui/badge';
import type { StatusResult } from '@/lib/status';

const LABEL: Record<string, string> = {
  online: 'Online',
  offline: 'Offline',
  unknown: 'Unknown',
};

export function StatusBadge({ result }: { result: StatusResult }) {
  const status = result.status;
  const className =
    status === 'online'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
      : status === 'offline'
        ? 'border-red-500/30 bg-red-500/10 text-red-300'
        : 'border-white/15 bg-white/5 text-white/60';

  const detail =
    result.kind === 'minecraft-java' && result.status === 'online'
      ? `${result.players ?? 0}/${result.maxPlayers ?? 0}`
      : null;

  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline" className={className}>
        {LABEL[status] ?? status}
      </Badge>
      {detail && <span className="text-xs text-white/50">{detail}</span>}
    </div>
  );
}
