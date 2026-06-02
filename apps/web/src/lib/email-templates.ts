export interface EmailContent {
  subject: string;
  html: string;
}

function layout(opts: { heading: string; intro: string; url: string; cta: string }): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#0b0b0c;color:#e7e7ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0c;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#151518;border:1px solid #26262b;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px;">
                <div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;">voz.gg</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0;">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#ffffff;">${opts.heading}</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#b5b5bd;">${opts.intro}</p>
                <a href="${opts.url}" style="display:inline-block;background:#6366f1;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">${opts.cta}</a>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#7c7c86;">Or paste this link into your browser:<br /><a href="${opts.url}" style="color:#9aa0ff;word-break:break-all;">${opts.url}</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 28px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#5c5c66;">If you weren't expecting this email, you can safely ignore it. This link expires in 1 hour.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function magicLinkSignInEmail({ url }: { url: string }): EmailContent {
  return {
    subject: 'Sign in to voz.gg',
    html: layout({
      heading: 'Sign in to voz.gg',
      intro: 'Click the button below to sign in to your account.',
      url,
      cta: 'Sign in',
    }),
  };
}

export function inviteApprovedEmail({ url }: { url: string }): EmailContent {
  return {
    subject: "You're approved — welcome to voz.gg",
    html: layout({
      heading: "You're in!",
      intro: 'Your invite request was approved. Click below to set up your account and sign in.',
      url,
      cta: 'Accept your invite',
    }),
  };
}
