import type { Browser } from 'playwright-core';
import https from 'https';

// Shared TeamWork web-session helpers — used by BOTH the late-filing sync and
// the AR-reminder workflow sync. TeamWork's login page runs reCAPTCHA v3, so
// a real (headless) browser performs the login once per run; every subsequent
// per-company call is a plain HTTP POST with the extracted PHPSESSID cookie.

const BASE = 'https://apps.teamworkcss.com/tassure_asia';
const USERNAME = process.env.TEAMWORK_USERNAME || 'Vincent'; // TODO remove fallback once TEAMWORK_USERNAME is set in Vercel env
const PASSWORD = process.env.TEAMWORK_PASSWORD || 'Pass@123'; // TODO remove fallback once TEAMWORK_PASSWORD is set in Vercel env

export function parseDmy(s: string): Date | null {
  const clean = (s || '').replace(/<[^>]+>/g, '').trim();
  const m = clean.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}`);
}

export function toIsoDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
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

export async function getSessionCookie(): Promise<string> {
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

// Per-company AGM/AR event history. Each row (per TeamWork's DataTable):
// [event, ?, fyeDate, ?, dueDate, heldDate, filingDate, ...] as dd/mm/yyyy
// strings (possibly wrapped in HTML).
export function fetchAgmList(cookie: string, companyId: string): Promise<{ data: string[][] }> {
  return new Promise((resolve, reject) => {
    const params: Record<string, string> = {
      draw: '1', start: '0', length: '50',
      'search[value]': '', 'search[regex]': 'false',
      'order[0][column]': '1', 'order[0][dir]': 'desc',
      ci_csrf_token: '', company_id: companyId,
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
      hostname: 'apps.teamworkcss.com', path: '/tassure_asia/company_agm/agm_list_ajax', method: 'POST',
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
