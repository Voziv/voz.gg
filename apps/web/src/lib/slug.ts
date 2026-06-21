// slugifyServerName produces a systemd/filesystem-safe unit-name key: lowercase
// [a-z0-9-], spaces/underscores → hyphens, collapsed and trimmed. Falls back to
// "server" so a name of only punctuation still yields a usable unit name. The
// agent re-sanitizes, so this only needs to be reasonable.
export function slugifyServerName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'server';
}
