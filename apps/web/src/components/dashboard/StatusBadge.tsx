import { Badge } from '../ui/badge';

type Props = {
  status: 'online' | 'offline' | 'unknown';
  players?: number;
  maxPlayers?: number;
};

export default function StatusBadge({ status, players, maxPlayers }: Props) {
  if (status === 'online') {
    const hasCounts = players !== undefined && maxPlayers !== undefined;
    return (
      <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
        {hasCounts ? `Online · ${players}/${maxPlayers}` : 'Online'}
      </Badge>
    );
  }
  if (status === 'offline') {
    return (
      <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-400">
        Offline
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
      Unknown
    </Badge>
  );
}
