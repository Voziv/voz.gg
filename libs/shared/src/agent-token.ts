export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

// Pulls the raw token out of an `Authorization: Bearer <token>` header value.
// The capture group requires a leading non-space (`\S`) so `\s+` and the capture
// cannot both match whitespace — without that the two quantifiers overlap and an
// attacker-supplied header backtracks polynomially (ReDoS) on the public endpoint.
export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S.*)$/i.exec(header.trim());
  return match ? match[1] : null;
}
