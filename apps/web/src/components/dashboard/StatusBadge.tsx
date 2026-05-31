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
      <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
        {hasCounts ? `Online · ${players}/${maxPlayers}` : 'Online'}
      </Badge>
    );
  }
  if (status === 'offline') {
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
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
