/* Sending the hosted account's own mail (welcome, password reset, setup link): through Resend, with
 * the key in AIRCHECK_RESEND_KEY, from AIRCHECK_MAIL_FROM (a sender on a domain verified in that
 * Resend account), with replies to AIRCHECK_MAIL_REPLY_TO when set. A send that fails is logged and
 * swallowed: an email must never block a sign-up or a sign-in. Without a key nothing is sent, and a
 * local install needs none. */

const FROM = () => process.env.AIRCHECK_MAIL_FROM || 'Aircheck <hello@aircheck.dev>';
const REPLY_TO = () => process.env.AIRCHECK_MAIL_REPLY_TO || '';

export const mailEnabled = () => !!process.env.AIRCHECK_RESEND_KEY;

export async function sendMail(to: string, m: { subject: string; html: string; text: string }, idempotencyKey?: string): Promise<boolean> {
  const key = process.env.AIRCHECK_RESEND_KEY;
  if (!key) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
      body: JSON.stringify({ from: FROM(), to: [to], ...(REPLY_TO() ? { reply_to: REPLY_TO() } : {}), subject: m.subject, html: m.html, text: m.text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) console.error(`aircheck mail: Resend answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.ok;
  } catch (err) {
    console.error(`aircheck mail: ${(err as Error).message}`);
    return false;
  }
}
