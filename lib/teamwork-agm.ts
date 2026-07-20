import type { Browser } from 'playwright-core';
import https from 'https';
import { readdir, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

// Shared TeamWork web-session helpers — used by BOTH the late-filing sync and
// the AR-reminder workflow sync. TeamWork's login page runs reCAPTCHA v3, so
// a real (headless) browser performs the login once per run; every subsequent
// per-company call is a plain HTTP POST with the extracted PHPSESSID cookie.

const BASE = 'https://apps.teamworkcss.com/tassure_asia';

const PLAYWRIGHT_TEMP_PREFIXES = [
  'playwright_chromiumdev_profile-',
  'playwright-artifacts-',
];

async function removeStalePlaywrightTempDirs() {
  // Vercel reuses Fluid compute instances between cron invocations. Chromium
  // can leave sizable profiles in /tmp after a terminated invocation; once
  // free space drops below 64 MB, the next browser closes during login.
  // Only remove profiles old enough that they cannot belong to a concurrently
  // starting request. Scheduled browser jobs are separated by at least 1 hour.
  const root = tmpdir();
  const cutoff = Date.now() - 2 * 60_000;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }

  await Promise.all(entries
    .filter(name => PLAYWRIGHT_TEMP_PREFIXES.some(prefix => name.startsWith(prefix)))
    .map(async name => {
      const target = path.join(root, name);
      try {
        if ((await stat(target)).mtimeMs < cutoff) {
          await rm(target, { recursive: true, force: true });
        }
      } catch {
        // Cleanup is best-effort; login should still report the real failure.
      }
    }));
}

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
    await removeStalePlaywrightTempDirs();
    const chromium = (await import('@sparticuz/chromium')).default;
    const { chromium: pwChromium } = await import('playwright-core');
    return pwChromium.launch({
      args: [
        ...chromium.args,
        '--disable-dev-shm-usage',
        '--disk-cache-size=0',
        '--media-cache-size=0',
        '--disable-gpu-shader-disk-cache',
      ],
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  const { chromium: localChromium } = await import('playwright');
  return localChromium.launch({ headless: true }) as unknown as Browser;
}

export async function getSessionCookie(): Promise<string> {
  const username = process.env.TEAMWORK_USERNAME;
  const password = process.env.TEAMWORK_PASSWORD;
  if (!username || !password) {
    throw new Error('TEAMWORK_USERNAME and TEAMWORK_PASSWORD are required.');
  }
  const browser = await getBrowser();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    if (page.url().includes('welcome')) {
      await page.getByRole('textbox', { name: 'Username' }).fill(username);
      await page.getByRole('textbox', { name: 'Password' }).fill(password);
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

type TeamworkDataTableResult = {
  data: string[][];
  recordsTotal?: number;
  recordsFiltered?: number;
};

// Per-company AGM/AR event history. Each row (per TeamWork's DataTable):
// [event, ?, fyeDate, ?, dueDate, heldDate, filingDate, ...] as dd/mm/yyyy
// strings (possibly wrapped in HTML).
function fetchAgmPage(
  cookie: string,
  companyId: string,
  start: number,
  length: number,
): Promise<TeamworkDataTableResult> {
  return new Promise((resolve, reject) => {
    const params: Record<string, string> = {
      draw: String(Math.floor(start / length) + 1), start: String(start), length: String(length),
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
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`TeamWork AGM HTTP ${res.statusCode ?? 'unknown'}`));
          return;
        }
        try {
          const parsed = JSON.parse(data) as TeamworkDataTableResult;
          if (!Array.isArray(parsed.data)) throw new Error('TeamWork AGM response has no data array.');
          resolve(parsed);
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(20_000, () => req.destroy(new Error('TeamWork AGM request timed out after 20 seconds.')));
    req.write(body);
    req.end();
  });
}

export async function fetchAgmList(cookie: string, companyId: string): Promise<{ data: string[][] }> {
  const pageSize = 100;
  const maximumRows = 2_000;
  const rows: string[][] = [];
  const seen = new Set<string>();

  for (let start = 0; start < maximumRows; start += pageSize) {
    const page = await fetchAgmPage(cookie, companyId, start, pageSize);
    for (const row of page.data) {
      const key = JSON.stringify(row);
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(row);
      }
    }

    const total = page.recordsFiltered ?? page.recordsTotal;
    if (page.data.length < pageSize || (typeof total === 'number' && start + page.data.length >= total)) break;
    if (page.data.length && rows.length < start + page.data.length) {
      throw new Error('TeamWork AGM pagination repeated an earlier page.');
    }
  }

  return { data: rows };
}
