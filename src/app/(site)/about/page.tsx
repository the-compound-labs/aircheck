import type { Metadata } from 'next';
import { LegalPage, legalMeta } from '../LegalPage';
import './about.css';
import { REPO } from '@/lib/project';

/* /about: the reader page shape /privacy, /terms and /contact share (../LegalPage.tsx), with three
 * short sections. */
export const metadata: Metadata = {
  ...legalMeta('About', 'about'),
  description: 'Aircheck is made by Compound Labs, an independent product R&D lab that builds and operates its own products. Learn why Aircheck exists and who makes it.',
};

export default function About() {
  return (
    <LegalPage title="About">
      <p>Aircheck is made by Compound Labs, an independent product R&amp;D lab that builds and operates its own products.</p>
      <section className="about-section">
        <h2>Compound Labs</h2>
        <p>Compound Labs is an independent product R&amp;D lab. It builds and operates apps and developer tools, explores applied AI, and publishes what it learns.</p>
        <p>The lab builds and operates its own products. It does not offer client services or custom development. Its work ships as public products, working prototypes, operational systems, build notes, changelogs and findings.</p>
      </section>
      <section className="about-section">
        <h2>Why Aircheck exists</h2>
        <p>Aircheck shows every post your agents queued for today on one screen. It shows each post&apos;s media. It lets you fix a post before it goes out.</p>
        <p>Agents and scheduled jobs queue posts while nobody watches. Aircheck reads what your Claude Code, Codex, cron, Airflow and launchd jobs queued. It shows whether each post is ready and lets you preview, revise or repair it. Your media stays on your machine. Aircheck never posts for you.</p>
      </section>
      <section className="about-section">
        <h2>Learn more</h2>
        <p>Read about Compound Labs at <a href="https://thecompound.tech">thecompound.tech</a>. The Aircheck source code is on <a href={REPO}>GitHub</a>.</p>
      </section>
    </LegalPage>
  );
}
