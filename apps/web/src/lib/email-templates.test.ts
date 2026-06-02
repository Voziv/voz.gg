import { describe, it, expect } from 'vitest';
import { magicLinkSignInEmail, inviteApprovedEmail } from './email-templates';

describe('email templates', () => {
  const url = 'https://voz.gg/api/auth/magic-link/verify?token=abc';

  it('magicLinkSignInEmail embeds the url and has a sign-in subject', () => {
    const { subject, html } = magicLinkSignInEmail({ url });
    expect(html).toContain(url);
    expect(subject.toLowerCase()).toContain('sign in');
  });

  it('inviteApprovedEmail embeds the url and has a distinct subject', () => {
    const signIn = magicLinkSignInEmail({ url });
    const invite = inviteApprovedEmail({ url });
    expect(invite.html).toContain(url);
    expect(invite.subject).not.toBe(signIn.subject);
    expect(invite.subject.toLowerCase()).toContain('voz.gg');
  });
});
