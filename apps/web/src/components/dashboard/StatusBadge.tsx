import { Badge } from '../ui/badge';

// Sub-project #6 (status monitor) replaces this with live online/offline data.
export default function StatusBadge() {
  return (
    <Badge variant="outline" className="border-white/15 bg-white/5 text-white/60">
      Unknown
    </Badge>
  );
}
