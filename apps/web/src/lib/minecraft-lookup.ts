// Client-side wrapper around GET /api/profile/minecraft. Every failure mode —
// an upstream error (503 `upstream`), a redirect to /sign-in whose HTML body is
// not JSON, or a network drop — must resolve to a visible message rather than a
// rejected promise, otherwise the field hangs on its "checking" spinner forever.

export type LookupOutcome =
  | { ok: true; uuid: string; name: string }
  | { ok: false; message: string };

const UNREACHABLE_MESSAGE = "Couldn't reach Minecraft. Try again.";

export function lookupErrorMessage(error: string | undefined): string {
  switch (error) {
    case 'not_found':
      return 'No such Minecraft user.';
    case 'upstream':
      return UNREACHABLE_MESSAGE;
    default:
      return 'Invalid username.';
  }
}

export async function fetchMinecraftLookup(
  username: string,
  fetchFn: typeof fetch = fetch,
): Promise<LookupOutcome> {
  try {
    const res = await fetchFn(`/api/profile/minecraft?username=${encodeURIComponent(username)}`);
    const r = (await res.json()) as { ok?: boolean; uuid?: string; name?: string; error?: string };
    if (r.ok && r.uuid && r.name) return { ok: true, uuid: r.uuid, name: r.name };
    return { ok: false, message: lookupErrorMessage(r.error) };
  } catch {
    return { ok: false, message: UNREACHABLE_MESSAGE };
  }
}
