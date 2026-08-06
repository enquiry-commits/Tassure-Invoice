import https from 'https';

// Per-company profile page (Active Officials / Contact Details / Address) —
// same authenticated web session as lib/teamwork-agm.ts's AGM/AR history
// fetch, just a different endpoint. Kept in its own file since it serves a
// different purpose (company profile fields, not event history) and is used
// by a different pair of callers (one-time backfill script + the nightly
// rotating sync route).
//
// Verified against TeamWork's own getCompanies bulk API first (2026-08-06):
// that endpoint's company_secretary_staff/company_email_address/company_
// telephone_number fields come back essentially empty (0/18, 2/18, 0/18 in a
// spot check), even for companies with known-correct data elsewhere — but
// this per-company page has the real, current data (confirmed against 4 real
// companies' Secretary against master_list). Email/Tel are NOT extracted
// here even though the page has fields for them: TeamWork itself has no
// email on file for most companies checked ("Not Specified"), and Phone 1/2
// are almost always the bare "65-" country-code placeholder — auto-syncing
// either would overwrite good, richer manually-curated master_list data with
// worthless placeholders. Only Secretary (verified reliable) is extracted.
const BASE = 'https://apps.teamworkcss.com/tassure_asia';

export type CompanyProfile = {
  companyId: string;
  secretaries: string[];
};

function fetchProfileHtml(cookie: string, companyId: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('TeamWork company profile request was cancelled.'));
      return;
    }
    const req = https.request({
      hostname: 'apps.teamworkcss.com',
      path: `/tassure_asia/view_company/${companyId}/?comp`,
      method: 'GET',
      headers: { Cookie: cookie },
    }, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`TeamWork company profile HTTP ${res.statusCode ?? 'unknown'}`));
          return;
        }
        resolve(data);
      });
    });
    const abortRequest = () => req.destroy(
      signal?.reason instanceof Error ? signal.reason : new Error('TeamWork company profile request was cancelled.'),
    );
    signal?.addEventListener('abort', abortRequest, { once: true });
    req.on('close', () => signal?.removeEventListener('abort', abortRequest));
    req.on('error', reject);
    req.setTimeout(20_000, () => req.destroy(new Error('TeamWork company profile request timed out after 20 seconds.')));
    req.end();
  });
}

// "tble articles_constitution" is reused by an unrelated earlier table on the
// page (a literal "Articles/Constitution" info block) — scope the search to
// start after the "Active Officials" heading so the first match of that
// class after that point is the real officials table.
function extractSecretaries(html: string): string[] {
  const headingIdx = html.indexOf('Active Officials');
  if (headingIdx === -1) return [];
  const after = html.slice(headingIdx);
  const tableMatch = after.match(/<table[^>]*class="tble articles_constitution"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) return [];
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  const names: string[] = [];
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tableMatch[1]))) {
    const cellRe = /<td[^>]*><label[^>]*>([\s\S]*?)<\/label><\/td>/g;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    if (cells.length !== 5 || cells[0] === 'Name') continue;
    if (cells[1] === 'Secretary') names.push(cells[0]);
  }
  return names;
}

export async function fetchCompanyProfile(cookie: string, companyId: string, signal?: AbortSignal): Promise<CompanyProfile> {
  const html = await fetchProfileHtml(cookie, companyId, signal);
  return { companyId, secretaries: extractSecretaries(html) };
}

// TeamWork throttles this endpoint at roughly a fixed total throughput
// (measured 2026-08-06: ~500ms/company whether concurrency is 5, 10, or 20 —
// raising concurrency does not raise throughput), so a modest concurrency is
// enough; there is no benefit to pushing it higher.
export async function fetchCompanyProfiles(
  cookie: string,
  companyIds: string[],
  concurrency = 10,
): Promise<{ results: CompanyProfile[]; errors: Array<{ companyId: string; error: string }> }> {
  const results: CompanyProfile[] = [];
  const errors: Array<{ companyId: string; error: string }> = [];
  let next = 0;
  const worker = async () => {
    while (next < companyIds.length) {
      const companyId = companyIds[next++];
      try {
        results.push(await fetchCompanyProfile(cookie, companyId));
      } catch (error) {
        errors.push({ companyId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, companyIds.length) }, () => worker()));
  return { results, errors };
}
