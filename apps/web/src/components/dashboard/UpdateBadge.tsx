import { Badge } from '../ui/badge';
import { updateBadge } from '../../lib/server-update-display';

type Props = {
  updateSource: string | null;
  currentVersion: string | null;
  availableVersion: string | null;
  lastError: string | null;
  applyStatus: string | null;
};

export default function UpdateBadge({ updateSource, currentVersion, availableVersion, lastError, applyStatus }: Props) {
  const { kind, label } = updateBadge({ updateSource, currentVersion, availableVersion, lastError, applyStatus });

  if (kind === 'untracked') return null;

  if (kind === 'up_to_date') {
    return (
      <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
        {label}
      </Badge>
    );
  }
  if (kind === 'available') {
    return (
      <Badge variant="outline" className="border-warn/30 bg-warn/10 text-warn">
        {label}
      </Badge>
    );
  }
  if (kind === 'failed') {
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
        {label}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
      {label}
    </Badge>
  );
}
