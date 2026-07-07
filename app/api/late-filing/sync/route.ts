import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import type { Browser } from 'playwright-core';
import https from 'https';

/**
 * Auto-detects late filers directly from TeamWork's own "Due Date Tracker",
 * which reflects TeamWork staff's real AGM/AR Held/Filed status — far more
 * reliable than our own ar_reminder.filling_date shadow tracking.
 *
 * TeamWork's login page has Google reCAPTCHA v3, so a pure-HTTP login isn't
 * viable — a real browser logs in once (fast, single navigation), then the
 * extracted PHPSESSID cookie is reused for plain HTTP calls to the
 * DataTables endpoint (/mainadmin/duedate_listing). No further browser use
 * needed, unlike the ND appointment sync which required many page visits —
 * this stays well within Vercel's function time limit.
 *
 * Only INSERTS newly-detected late companies (matched by UEN/name) — never
 * overwrites existing manual entries (which may carry hand-written remarks
 * like "ACRA STRIKE OFF").
 */

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

const BASE = 'https://apps.teamworkcss.com/tassure_asia';
const USERNAME = 'Vincent';
const PASSWORD = 'Pass@123';
const MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

function parseDmy(s: string): { iso: string; month: number } | null {
  const m = (s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return { iso: `${m[3]}-${m[2]}-${m[1]}`, month: parseInt(m[2], 10) };
}

async function getBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    const chromium = (await import('@sparticuz/chromium')).default;
    const { chromium: pwChromium } = await import('playwright-core');
    return pwChromium.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  }
  const { chromium: localChromium } = await import('playwright');
  return localChromium.launch({ headless: true }) as unknown as Browser;
}

async function getSessionCookie(): Promise<string> {
  const browser = await getBrowser();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('welcome')) {
      await page.getByRole('textbox', { name: 'Username' }).fill(USERNAME);
      await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
      await page.getByRole('button', { name: ' Login' }).click();
      await page.waitForURL('**/dashboard**', { timeout: 15000, waitUntil: 'domcontentloaded' });
    }
    const cookies = await context.cookies();
    const phpsessid = cookies.find(c => c.name === 'PHPSESSID');
    if (!phpsessid) throw new Error('Login failed — no PHPSESSID cookie obtained');
    return `PHPSESSID=${phpsessid.value}`;
  } finally {
    await browser.close();
  }
}

function fetchDueDateTracker(cookie: string): Promise<{ recordsTotal: number; data: (string | number)[][] }> {
  return new Promise((resolve, reject) => {
    const params: Record<string, string> = {
      draw: '1', start: '0', length: '3000',
      'search[value]': '', 'search[regex]': 'false',
      'order[0][column]': '0', 'order[0][dir]': 'asc',
      ci_csrf_token: '', comid: '', statu: 'Pending', month: '', eventval: '', year: '', cli: 'all',
    };
    for (let i = 0; i < 9; i++) {
      params[`columns[${i}][data]`] = String(i);
      params[`columns[${i}][searchable]`] = 'true';
      params[`columns[${i}][orderable]`] = 'true';
      params[`columns[${i}][search][value]`] = '';
      params[`columns[${i}][search][regex]`] = 'false';
    }
    const body = new URLSearchParams(params).toString();
    const req = https.request({
      hostname: 'apps.teamworkcss.com',
      path: '/tassure_asia/mainadmin/duedate_listing',
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function GET() {
  const supabase = createAdminClient();

  const cookie = await getSessionCookie();
  const result = await fetchDueDateTracker(cookie);

  const today = new Date().toISOString().slice(0, 10);
  type Overdue = { entityName: string; companyId: string | null; event: string; dueDateIso: string; fyeMonth: string | null };
  const overdue: Overdue[] = [];

  for (const row of result.data) {
    const [, entityName, , fyeDateRaw, event, dueDateRaw, , status, actionsHtml] = row as [number, string, string, string, string, string, string, string, string];
    if (status !== 'Pending') continue;
    if (!['AGM', 'AR'].includes(event)) continue;
    const dueDate = parseDmy(dueDateRaw);
    if (!dueDate || dueDate.iso >= today) continue;

    const companyIdMatch = actionsHtml.match(/company_id="(\d+)"/);
    const fyeDate = parseDmy(fyeDateRaw);
    overdue.push({
      entityName,
      companyId: companyIdMatch ? companyIdMatch[1] : null,
      event,
      dueDateIso: dueDate.iso,
      fyeMonth: fyeDate ? MONTH_ABBR[fyeDate.month - 1] : null,
    });
  }

  const byCompany = new Map<string, Overdue>();
  for (const o of overdue) {
    const existing = byCompany.get(o.entityName);
    if (!existing || o.dueDateIso < existing.dueDateIso) byCompany.set(o.entityName, o);
  }

  const { data: companies } = await supabase.from('companies').select('internal_id, registration_no');
  const uenByInternalId = new Map((companies ?? []).map(c => [c.internal_id, c.registration_no]));

  const { data: existingManual } = await supabase.from('late_filing_companies').select('uen, company_name');
  const existingUens = new Set((existingManual ?? []).map(r => r.uen).filter(Boolean));
  const existingNames = new Set((existingManual ?? []).map(r => r.company_name.toLowerCase()));

  let inserted = 0;
  const insertedNames: string[] = [];

  for (const [entityName, o] of byCompany) {
    const uen = o.companyId ? uenByInternalId.get(o.companyId) : null;
    const alreadyExists = (uen && existingUens.has(uen)) || existingNames.has(entityName.toLowerCase());
    if (alreadyExists) continue;

    const { error } = await supabase.from('late_filing_companies').insert({
      company_name: entityName,
      uen: uen || null,
      financial_year_end: o.fyeMonth,
      next_agm_due_date: o.dueDateIso,
      remarks: null,
    });
    if (!error) { inserted++; insertedNames.push(entityName); }
  }

  return NextResponse.json({ ok: true, totalPendingEvents: result.recordsTotal, overdueCompanies: byCompany.size, inserted, insertedNames });
}
