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

// A single row of the "Active Officials" table — Director, Secretary,
// Controller (Registrable Controller under RORC — commonly but not always
// the same people as shareholders; there is no distinct "Shareholder" role
// or share-count column on this page), Representative, or Contact Person.
// idNo covers both personal NRIC/FIN/passport numbers and, for a corporate
// controller/director, that entity's own UEN — see inferIdType below.
export type CompanyOfficial = { name: string; role: string; idNo: string; address: string; dateOfAppointment: string };

// One row of the "Shareholders Information" table — the actual share
// register (distinct from the "Active Officials" Controller rows above,
// which have no share data at all). Confirmed present on the same page,
// under its own "Shareholders Information" heading.
export type ShareholderShareInfo = {
  name: string; issuedShareCapital: string; paidUpCapital: string;
  considerationPaidUpCapital: string; numberOfShares: string; currency: string;
  shareType: string; shareClass: string;
};

export type CompanyProfileFull = CompanyProfile & { officials: CompanyOfficial[]; shareholderShares: ShareholderShareInfo[] };

// Singapore NRIC/FIN are a fixed 9-character shape (letter + 7 digits +
// checksum letter); local UENs are 9-10 characters, digits with a trailing
// checksum letter, but no S/T/F/G prefix. Passports vary by issuing country
// with no fixed shape. This is a best-effort classification for pre-filling
// a form field, not a validated determination — always editable by staff.
export function inferIdType(idNo: string): 'NRIC' | 'FIN' | 'UEN' | 'PASSPORT' {
  const v = (idNo || '').trim().toUpperCase();
  if (/^[ST]\d{7}[A-Z]$/.test(v)) return 'NRIC';
  if (/^[FG]\d{7}[A-Z]$/.test(v)) return 'FIN';
  if (/^\d{8,9}[A-Z]$/.test(v) || /^(19|20)\d{7}[A-Z]$/.test(v)) return 'UEN';
  return 'PASSPORT';
}

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
function extractOfficials(html: string): CompanyOfficial[] {
  const headingIdx = html.indexOf('Active Officials');
  if (headingIdx === -1) return [];
  const after = html.slice(headingIdx);
  const tableMatch = after.match(/<table[^>]*class="tble articles_constitution"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) return [];
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  const officials: CompanyOfficial[] = [];
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tableMatch[1]))) {
    const cellRe = /<td[^>]*><label[^>]*>([\s\S]*?)<\/label><\/td>/g;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    if (cells.length !== 5 || cells[0] === 'Name') continue;
    officials.push({ name: cells[0], role: cells[1], idNo: cells[2], address: cells[3], dateOfAppointment: cells[4] });
  }
  return officials;
}

// The company profile page renders a "Shareholders Information" heading
// THREE times with three different table variants (confirmed 2026-08-09):
// an empty hidden-state placeholder, the real current share register (8
// columns: Shareholder Name, Issued Share Capital, Paid-up Capital,
// Consideration Paid-up Capital, Number of Share, Currency, Share Type,
// Share Class), and a separate share-transaction-history table with a
// different column set entirely. Anchoring on the heading text picks
// whichever occurs first — the empty placeholder — so anchor instead on
// "Consideration Paid up Capital", a header phrase unique to the real
// table, then find its enclosing <table>...</table> directly.
function extractShareholderShares(html: string): ShareholderShareInfo[] {
  const anchorIdx = html.indexOf('Consideration Paid up Capital');
  if (anchorIdx === -1) return [];
  const tableStart = html.lastIndexOf('<table', anchorIdx);
  const tableEnd = html.indexOf('</table>', anchorIdx);
  if (tableStart === -1 || tableEnd === -1) return [];
  const tableHtml = html.slice(tableStart, tableEnd);
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  const out: ShareholderShareInfo[] = [];
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(tableHtml))) {
    const cellRe = /<td[^>]*><label[^>]*>([\s\S]*?)<\/label><\/td>/g;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
    if (cells.length !== 8 || cells[0] === 'Shareholder Name') continue;
    out.push({
      name: cells[0], issuedShareCapital: cells[1], paidUpCapital: cells[2],
      considerationPaidUpCapital: cells[3], numberOfShares: cells[4], currency: cells[5],
      shareType: cells[6], shareClass: cells[7],
    });
  }
  return out;
}

export async function fetchCompanyProfile(cookie: string, companyId: string, signal?: AbortSignal): Promise<CompanyProfile> {
  const html = await fetchProfileHtml(cookie, companyId, signal);
  const officials = extractOfficials(html);
  return { companyId, secretaries: officials.filter(o => o.role === 'Secretary').map(o => o.name) };
}

// Full "Active Officials" + "Shareholders Information" data — Directors,
// Controllers, etc. with ID number/address/appointment date, and the real
// share register (name/share count/paid-up capital/currency/type), not just
// the Secretary name. Used both by the Post Incorporate UEN lookup (reading
// the nightly-synced copy — see teamwork_company_officials/
// teamwork_shareholder_shares) and by the nightly sync-secretary route,
// which fetches this same full profile once per company and also writes it
// through to those two tables so Post Incorporate never needs its own live
// TeamWork fetch.
export async function fetchCompanyProfileFull(cookie: string, companyId: string, signal?: AbortSignal): Promise<CompanyProfileFull> {
  const html = await fetchProfileHtml(cookie, companyId, signal);
  const officials = extractOfficials(html);
  const shareholderShares = extractShareholderShares(html);
  return { companyId, secretaries: officials.filter(o => o.role === 'Secretary').map(o => o.name), officials, shareholderShares };
}

// Bulk variant of fetchCompanyProfileFull, mirroring fetchCompanyProfiles'
// concurrency pattern below.
export async function fetchCompanyProfilesFull(
  cookie: string,
  companyIds: string[],
  concurrency = 10,
): Promise<{ results: CompanyProfileFull[]; errors: Array<{ companyId: string; error: string }> }> {
  const results: CompanyProfileFull[] = [];
  const errors: Array<{ companyId: string; error: string }> = [];
  let next = 0;
  const worker = async () => {
    while (next < companyIds.length) {
      const companyId = companyIds[next++];
      try {
        results.push(await fetchCompanyProfileFull(cookie, companyId));
      } catch (error) {
        errors.push({ companyId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, companyIds.length) }, () => worker()));
  return { results, errors };
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
