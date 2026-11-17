import type { Metadata } from 'next';
import { LegalPage, legalMeta } from '../LegalPage';

export const metadata: Metadata = legalMeta('Terms', 'terms');

export default function Terms() {
  return (
    <LegalPage title="Terms">
      <p>Compound Labs provides Aircheck as is and without warranty of any kind. You run it on your machine, against your jobs and accounts. You remain responsible for everything those jobs post. Aircheck does not post for you. It shows what your jobs queued and replaces a queued post only when you approve a repair. Compound Labs is not liable for any loss arising from your use of the software.</p>
      <p>Aircheck source code uses open-source licenses. The MCP server, setup skill and file schemas use MIT. The web app uses AGPL-3.0. Those licenses govern your use of the code. These terms govern your use of aircheck.dev. The Aircheck and Compound Labs names and marks are not licensed.</p>
    </LegalPage>
  );
}
