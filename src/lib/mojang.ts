import 'server-only';

export type MojangProfile = { uuid: string; name: string };

const MOJANG_RE = /^[A-Za-z0-9_]{3,16}$/;

export function isValidMinecraftUsernameSyntax(name: string): boolean {
  return MOJANG_RE.test(name);
}

function dashUuid(undashed: string): string {
  return [
    undashed.slice(0, 8),
    undashed.slice(8, 12),
    undashed.slice(12, 16),
    undashed.slice(16, 20),
    undashed.slice(20),
  ].join('-');
}

export async function lookupMinecraftProfile(
  username: string,
  signal?: AbortSignal,
): Promise<MojangProfile | null> {
  if (!isValidMinecraftUsernameSyntax(username)) return null;
  const url = `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`;
  const res = await fetch(url, {
    signal,
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404 || res.status === 204) return null;
  if (!res.ok) return null;
  const json = (await res.json()) as { id?: string; name?: string };
  if (!json.id || !json.name) return null;
  return { uuid: dashUuid(json.id), name: json.name };
}
