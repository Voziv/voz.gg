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
