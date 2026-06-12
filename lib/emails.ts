/**
 * Transactional email templates, sent through GHL (lib/ghl.ts sendEmail).
 * Inline styles only — email clients don't load stylesheets.
 */

const SUPPORT_NUMBER_DISPLAY = "+1 (888) 853-5324";
const SUPPORT_NUMBER_TEL = "+18888535324";

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://dispatch.loopflo.io";
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4ec;overflow:hidden;">
          <tr>
            <td style="padding:24px 32px;border-bottom:1px solid #ececf2;">
              <span style="display:inline-block;font-size:18px;font-weight:600;letter-spacing:-0.02em;color:#0a0a0f;">
                <span style="color:#2563eb;">&#9646;</span>&nbsp;Dispatch
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;letter-spacing:-0.02em;color:#0a0a0f;">${title}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #ececf2;font-size:12px;color:#8888aa;line-height:1.5;">
              Dispatch &mdash; Bluejaypro operations platform<br/>
              Need help? Call <a href="tel:${SUPPORT_NUMBER_TEL}" style="color:#2563eb;text-decoration:none;">${SUPPORT_NUMBER_DISPLAY}</a>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:#2563eb;color:#ffffff;font-size:14px;font-weight:500;padding:10px 20px;border-radius:8px;text-decoration:none;">${label}</a>`;
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3c3c50;">${html}</p>`;
}

function credentialBox(rows: Array<[string, string]>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#f8f8ff;border:1px solid #e4e4ec;border-radius:8px;margin:0 0 16px;">
    ${rows
      .map(
        ([label, value]) => `<tr>
      <td style="padding:10px 16px;font-size:12px;color:#8888aa;width:120px;">${label}</td>
      <td style="padding:10px 16px;font-size:13px;font-family:Menlo,Consolas,monospace;color:#0a0a0f;">${value}</td>
    </tr>`
      )
      .join("")}
  </table>`;
}

/** Email for a newly invited agency team member. */
export function teamInviteEmail(input: {
  email: string;
  tempPassword: string;
  roleLabel: string;
  invitedByName: string;
}): { subject: string; html: string } {
  const loginUrl = `${appUrl()}/login`;
  return {
    subject: "You've been invited to Dispatch",
    html: layout(
      "Welcome to the team",
      [
        paragraph(
          `${input.invitedByName} invited you to join <strong>Dispatch</strong>, Bluejaypro's operations platform, as <strong>${input.roleLabel}</strong>.`
        ),
        paragraph("Sign in with these temporary credentials:"),
        credentialBox([
          ["Login URL", `<a href="${loginUrl}" style="color:#2563eb;">${loginUrl}</a>`],
          ["Email", input.email],
          ["Temp password", input.tempPassword],
        ]),
        paragraph(
          "This password is temporary — after your first sign-in, set your own from <strong>Settings &rarr; Profile</strong>, or use &ldquo;Forgot password&rdquo; on the login page at any time."
        ),
        button(loginUrl, "Sign in to Dispatch"),
      ].join("")
    ),
  };
}

/** Welcome email for a client account owner when their portal account is created. */
export function clientOnboardingEmail(input: {
  email: string;
  fullName: string;
  companyName: string;
  tempPassword: string | null;
}): { subject: string; html: string } {
  const portalUrl = appUrl();
  const loginRows: Array<[string, string]> = [
    ["Portal URL", `<a href="${portalUrl}" style="color:#2563eb;">${portalUrl}</a>`],
    ["Email", input.email],
  ];
  if (input.tempPassword) loginRows.push(["Temp password", input.tempPassword]);

  return {
    subject: `Welcome to Dispatch — your ${input.companyName} portal is ready`,
    html: layout(
      `Welcome, ${input.fullName}`,
      [
        paragraph(
          `Your client portal for <strong>${input.companyName}</strong> is ready. Use it to chat with the Bluejaypro team, open and track support tickets, and follow your onboarding progress.`
        ),
        credentialBox(loginRows),
        paragraph(
          input.tempPassword
            ? "Sign in with the temporary password above, then set your own from your profile page. You can also use &ldquo;Forgot password&rdquo; on the login page."
            : "Sign in with your existing password, or use &ldquo;Forgot password&rdquo; on the login page to set a new one."
        ),
        paragraph(
          `Prefer the phone? Our support line is <a href="tel:${SUPPORT_NUMBER_TEL}" style="color:#2563eb;text-decoration:none;">${SUPPORT_NUMBER_DISPLAY}</a> — calls and texts route straight to your Dispatch workspace.`
        ),
        button(portalUrl, "Open your portal"),
      ].join("")
    ),
  };
}
