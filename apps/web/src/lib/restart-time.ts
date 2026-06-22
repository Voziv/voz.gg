// Restart times are entered/shown in the admin's local timezone but stored and
// provisioned as UTC "HH:MM". offsetMinutes is Date.getTimezoneOffset(): minutes
// to ADD to local wall-clock to reach UTC (UTC-5 returns +300). DST caveat: the
// offset is the admin's current one, so a stored UTC time drifts by an hour in
// local wall-clock across a DST boundary — acceptable for a nightly restart.
function shiftHm(hhmm: string, deltaMinutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = ((h * 60 + m + deltaMinutes) % 1440 + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function localHmToUtc(hhmm: string, offsetMinutes: number): string {
  return shiftHm(hhmm, offsetMinutes);
}

export function utcHmToLocal(hhmm: string, offsetMinutes: number): string {
  return shiftHm(hhmm, -offsetMinutes);
}

// Browser wrappers: use the running browser's current offset.
export function localTimeToUtc(hhmm: string): string {
  return localHmToUtc(hhmm, new Date().getTimezoneOffset());
}
export function utcTimeToLocal(hhmm: string): string {
  return utcHmToLocal(hhmm, new Date().getTimezoneOffset());
}
