export interface UpdateEvalInput {
  available: string | null;
  current: string | null;
  pinned: string | null;
  notified: string | null;
}

// We trust the upstream's "latest for channel" rather than comparing versions
// across heterogeneous schemes; "differs from current and not yet notified" is
// the trigger. A pin equal to the available version suppresses the alert.
export function evaluateUpdateNotification(input: UpdateEvalInput): { shouldNotify: boolean } {
  const { available, current, pinned, notified } = input;
  if (!available) return { shouldNotify: false };
  if (pinned && pinned === available) return { shouldNotify: false };
  if (available === current) return { shouldNotify: false };
  if (available === notified) return { shouldNotify: false };
  return { shouldNotify: true };
}
