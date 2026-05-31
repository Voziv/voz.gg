import { Badge } from '../ui/badge';

// Sub-project #6 (status monitor) replaces this with live online/offline data.
export default function StatusBadge() {
  return (
    <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
      Unknown
    </Badge>
  );
}
