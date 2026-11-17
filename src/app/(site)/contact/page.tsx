import type { Metadata } from 'next';
import { LegalPage, legalMeta } from '../LegalPage';

export const metadata: Metadata = legalMeta('Contact', 'contact');

export default function Contact() {
  return (
    <LegalPage title="Contact">
      <p>Compound Labs makes Aircheck as an independent product R&amp;D lab. Write to the team at <a href="mailto:hello@thecompound.tech">hello@thecompound.tech</a>.</p>
    </LegalPage>
  );
}
