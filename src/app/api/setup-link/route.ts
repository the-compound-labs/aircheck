import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { mailEnabled, sendMail } from '@/server/mail';
import { setupLinkMail } from '@/server/mail-template';

/* A phone visitor on /demo emails themself the setup guide, to open on a computer (2026-11-15).
 * Same-origin only. worker/admission.mjs meters it per client and overall before it gets here; the
 * Resend idempotency key holds it to one email per address per day. */
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const SENT = "We sent the link. Open the email on your computer.";
const INVALID = "Enter a valid email address.";
const ERROR = "We could not send the email. Try again.";

export async function POST(req: Request) {
  const origin = new URL(req.url).origin;
  if (req.headers.get('origin') !== origin) return NextResponse.json({ error: ERROR }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return NextResponse.json({ error: INVALID }, { status: 400 });
  if (!mailEnabled()) return NextResponse.json({ error: ERROR }, { status: 503 });
  const day = new Date().toISOString().slice(0, 10);
  const key = `setup-link/${createHash('sha256').update(email).digest('hex')}/${day}`;
  if (!(await sendMail(email, setupLinkMail(), key))) return NextResponse.json({ error: ERROR }, { status: 503 });
  return NextResponse.json({ ok: true, message: SENT }, { status: 202 });
}
