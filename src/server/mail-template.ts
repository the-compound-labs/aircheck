/* AIRCHECK'S MAIL. The layout lives in ./mail-layout.ts; this file only holds the copy. */

import { renderEmail } from './mail-layout';

const SITE = process.env.AIRCHECK_SITE_URL || 'https://aircheck.dev';

type Mail = { subject: string; html: string; text: string };

export function welcomeMail(): Mail {
  const subject = 'Welcome to Aircheck';
  const { html, text } = renderEmail('aircheck', {
    subject,
    preheader: 'Connect your computer and see every post your agents queued today.',
    context: 'Welcome',
    heading: 'Your Aircheck account is ready',
    blocks: [
      { p: 'Aircheck shows every post your agents queued for today, with its media, so you can fix one before it goes out.' },
      {
        steps: [
          ['Connect your computer', 'Open aircheck.dev and copy the one command it gives you into your terminal.'],
          ['Ask your agent to finish setup', 'Paste the setup prompt into Claude Code or Codex. It shows you each change before it makes it.'],
          ['Check today', 'Every queued post shows up with its images. Fix, preview or hold any of them.'],
        ],
      },
      { button: { label: 'Open Aircheck', url: SITE } },
      { note: 'Your images and video stay on your computer. aircheck.dev keeps only the JSON for each post.' },
    ],
  });
  return { subject, html, text };
}

export function resetMail(url: string): Mail {
  const subject = 'Reset your Aircheck password';
  const { html, text } = renderEmail('aircheck', {
    subject,
    preheader: 'This link resets your Aircheck password. It works once, for one hour.',
    context: 'Password reset',
    heading: 'Reset your password',
    blocks: [
      { p: 'Someone asked to reset the Aircheck password for this address. The link below works once, for one hour.' },
      { button: { label: 'Choose a new password', url } },
      { p: 'If you did not ask for this, ignore this email. Your password stays the same.' },
    ],
    pasteLink: url,
  });
  return { subject, html, text };
}

/** The setup link a phone visitor emails to themself from the demo (2026-11-15): Aircheck runs on a
 * computer, and about 95% of ad visitors are on a phone. */
export function setupLinkMail(): Mail {
  const subject = "Set up Aircheck on your computer";
  const { html, text } = renderEmail('aircheck', {
    subject,
    preheader: "Aircheck runs next to Claude Code or Codex. Open this email on your computer.",
    context: 'Setup',
    heading: "Set up Aircheck on your computer",
    blocks: [
      { p: "Open this email on the computer where you run Claude Code or Codex. The setup guide connects Aircheck to the posts your agents queue." },
      { button: { label: "Open the setup guide", url: `${SITE}/docs` } },
    ],
  });
  return { subject, html, text };
}
