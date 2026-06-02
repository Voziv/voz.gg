export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

export function resolveFromAddress(env: { FROM_EMAIL?: string }): string {
  if (!env.FROM_EMAIL) {
    throw new Error('FROM_EMAIL is not set; cannot send email.');
  }
  return env.FROM_EMAIL;
}

export async function sendEmail(env: Env, input: SendEmailInput): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: resolveFromAddress(env),
      to: input.to,
      subject: input.subject,
      html: input.html,
    }),
  });
  if (!response.ok) {
    throw new Error(`Email send failed: ${response.status} ${await response.text()}`);
  }
}
