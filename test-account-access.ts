// Which pages a login account may open — lib/approved-accounts.ts
// canAccountOpen() is THE check (proxy.ts, the sidebar, the assistant's page
// map and its billing tools all call it). 2026-10-04, Vincent: "TAO 这边就是
// 主要给 ACC 和 TAX 去开单的" — the Accounting/Tax team, confined to AR
// Reminder since 2026-08-17, may now also open TAO Billing.
//
// Run: npx tsx test-account-access.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { APPROVED_ACCOUNTS, getApprovedAccount, canAccountOpen, allowedPagesFor, type ApprovedAccount } from './lib/approved-accounts';
import { staffByTeam } from './lib/staff-directory';

const ROOT = process.env.ACCESS_GUARD_ROOT ?? process.cwd();
let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};
const can = (a: ApprovedAccount | null, href: string) => {
  const u = new URL(href, 'https://app.local');
  return !!a && canAccountOpen(a, u.pathname, u.searchParams);
};

console.log('--- the Accounting / Tax team ---');
const accTax = staffByTeam().filter(t => t.team === 'Accounting' || t.team === 'Tax').flatMap(t => t.members);
const withLogin = accTax.map(s => getApprovedAccount(s.email)).filter((a): a is ApprovedAccount => !!a);
check('the 6 Accounting/Tax staff with a login are exactly the 6 restricted accounts', withLogin.length === 6
  && JSON.stringify(withLogin.map(a => a.email).sort()) === JSON.stringify(APPROVED_ACCOUNTS.filter(a => a.restrictedTo).map(a => a.email).sort()));
for (const a of withLogin) {
  check(`${a.name}: AR Reminder + TAO Billing, home = AR Reminder`, JSON.stringify(allowedPagesFor(a)) === JSON.stringify(['/billing?tab=ar', '/billing/tao']), JSON.stringify(allowedPagesFor(a)));
}
const jay = getApprovedAccount('jaytay@tassure.com');
check('Jay can open AR Reminder and TAO Billing (also with extra query params)', can(jay, '/billing?tab=ar') && can(jay, '/billing/tao') && can(jay, '/billing/tao?company=X'));
check('… but still not Billing Drafts, SOA, Companies, Quotation, Reports or the Dashboard', ['/billing?tab=billing', '/billing/soa/all', '/companies', '/billing/quotation', '/reports', '/'].every(h => !can(jay, h)));
const missing = accTax.filter(s => !getApprovedAccount(s.email)).map(s => s.name);
console.log(`     (Accounting/Tax staff with no login account yet: ${missing.join(', ') || 'none'})`);

console.log('\n--- nobody else changed ---');
const vincent = getApprovedAccount('vincent@tassure.com');
const chelsea = getApprovedAccount('chelsea@tassure.com');
check('unrestricted accounts open everything (no allowed-page list)', allowedPagesFor(vincent!) === null && allowedPagesFor(chelsea!) === null && can(vincent, '/billing?tab=billing') && can(chelsea, '/billing/tao'));
check('alsoAllowed only ever extends a restricted account', APPROVED_ACCOUNTS.every(a => !a.alsoAllowed || !!a.restrictedTo));

console.log('\n--- source guards: one check, used everywhere ---');
{
  const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
  const walk = (d: string, out: string[] = []): string[] => {
    for (const f of readdirSync(d)) {
      if (['node_modules', '.next', '.git'].includes(f)) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p);
    }
    return out;
  };
  const files = [...['app', 'lib', 'components'].flatMap(d => walk(join(ROOT, d))), join(ROOT, 'proxy.ts')].map(f => relative(ROOT, f).replace(/\\/g, '/'));
  const copies = files.filter(f => f !== 'lib/approved-accounts.ts' && /isWithinRestriction\(account\.restrictedTo/.test(read(f)));
  check('no file checks restrictedTo itself — all go through canAccountOpen()', copies.length === 0, copies.join(', '));
  for (const f of ['proxy.ts', 'lib/assistant-pages.ts', 'app/api/assistant/route.ts', 'app/api/assistant/export/route.ts', 'app/api/billing/renewals/company/route.ts']) {
    check(`${f} uses canAccountOpen()`, /canAccountOpen\(account,/.test(read(f)));
  }
  check('/api/auth/me sends the allowed pages; AppShell passes them; the sidebar shows them', /allowedPages: allowedPagesFor\(account\)/.test(read('app/api/auth/me/route.ts'))
    && /allowedPages=\{user\?\.allowedPages \?\? null\}/.test(read('components/AppShell.tsx')) && /level1For\(restrictedTo, allowedPages\)/.test(read('components/Sidebar.tsx')));
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
