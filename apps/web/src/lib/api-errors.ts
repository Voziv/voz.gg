import { APIError } from 'better-auth/api';

// Log an unexpected internal error server-side (captured by Workers
// observability) and return a generic, user-safe message. Never surface the
// raw error to the client: it can leak internal details (upstream responses,
// stack traces, secrets in messages). Use for failures the user can't act on
// beyond retrying.
export function reportInternalError(
  context: string,
  error: unknown,
  userMessage: string,
  status = 500,
): Response {
  console.error(`[${context}]`, error);
  return Response.json({ ok: false, error: userMessage }, { status });
}

// Map an error thrown by a better-auth `auth.api.*` delegate call to a
// structured `{ ok: false, error }` response.
//
// A better-auth APIError carrying a 4xx status is a deliberate, client-safe
// rejection (e.g. "User not found", a plugin-level validation failure), so its
// message is surfaced verbatim. Anything else — a 5xx APIError or a non-API
// error (DB failure, thrown string) — is a genuine server fault that may leak
// internals, so it is logged and reported with the generic fallback message.
export function mapAuthApiError(context: string, error: unknown, fallbackMessage: string): Response {
  if (error instanceof APIError && error.statusCode >= 400 && error.statusCode < 500) {
    const message = error.body?.message || error.message || fallbackMessage;
    return Response.json({ ok: false, error: message }, { status: error.statusCode });
  }
  return reportInternalError(context, error, fallbackMessage);
}
