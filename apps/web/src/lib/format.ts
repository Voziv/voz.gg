export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function formatDatetime(value: Date): string {
  return value.toISOString().slice(0, 16).replace('T', ' ');
}

export function formatLastSeen(value: Date | null): string {
  return value ? formatDatetime(value) : '—';
}
