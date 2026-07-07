import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import type { Browser, Page } from 'playwright-core';

/**
 * Fully automated ND (Nominee Director) appointment sync, running as a
 * Vercel Cron job — cloud equivalent of scripts/sync-nd-appointments-auto.js.
 *
 * Logs into TeamWork, visits each known ND's "Company Appoinments" tab (the
 * only place TeamWork reliably shows the true "Sub Role: Nominee Director"
 * text — the REST API's nominee_dir/director_role fields don't correlate
 * with it, confirmed by direct comparison) and rebuilds nd_appointments from
 * that ground truth.
 *
 * A row counts as a valid, currently-active Nominee Director appointment
 * only if: Role === 'Nominee Director' AND Date of Cessation is empty.
 *
 * Full rebuild per run for all NDs with a known member_id — idempotent,
 * safe to run repeatedly. NDs without a member_id are left untouched.
 */

export const maxDuration = 300; // Vercel Pro allows up to 300s for Node functions
export const dynamic = 'force-dynamic';

const BASE = 'https://apps.teamworkcss.com/tassure_asia';
const USERNAME = 'Vincent';
const PASSWORD = 'Pass@123';

type AppointmentRow = { company: string; role: string; doapp: string; cessation: string; companyStatus: string };

function parseDate(s: string): string | null {
  const m = (s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

async function getBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    const chromium = (await import('@sparticuz/chromium')).default;
    const { chromium: pwChromium } = await import('playwright-core');
    return pwChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  // Local dev: use the regular playwright package's bundled chromium
  const { chromium: localChromium } = await import('playwright');
  return localChromium.launch({ headless: true }) as unknown as Browser;
}

async function login(page: Page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('welcome')) {
    await page.getByRole('textbox', { name: 'Username' }).fill(USERNAME);
    await page.getByRole('textbox', { name: 'Password' }).fill(PASSWORD);
    await page.getByRole('button', { name: ' Login' }).click();
    await page.waitForURL('**/dashboard**', { timeout: 15000, waitUntil: 'domcontentloaded' });
  }
}

async function scrapeMemberAppointments(page: Page, memberId: string): Promise<AppointmentRow[]> {
  await page.goto(`${BASE}/view_member/${memberId}/?var1=alldirector`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.getByRole('tab', { name: 'Company Appoinments' }).click({ timeout: 10000 });
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select#status'));
    const visible = selects.find(s => (s as HTMLElement).offsetParent !== null) as HTMLSelectElement | undefined;
    if (visible) { visible.value = '0'; visible.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(1200);

  return page.evaluate(() => {
    const history = document.querySelector('#history');
    if (!history) return [];
    const out: { company: string; role: string; doapp: string; cessation: string; companyStatus: string }[] = [];
    for (const tr of history.querySelectorAll('tr')) {
      const tds = tr.querySelectorAll('td');
      if (tds.length === 5) {
        const cells = Array.from(tds).map(td => (td as HTMLElement).innerText.trim());
        if (cells[0] && cells[0] !== 'Company Name') {
          out.push({ company: cells[0], role: cells[1], doapp: cells[2], cessation: cells[3], companyStatus: cells[4] });
        }
      }
    }
    return out;
  });
}

export async function GET() {
  const supabase = createAdminClient();

  const { data: nds, error } = await supabase.from('nominee_directors').select('id, name, member_id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withMemberId = (nds ?? []).filter(n => n.member_id);

  let browser: Browser | null = null;
  const results: Record<number, AppointmentRow[]> = {};
  const errors: Record<number, string> = {};

  try {
    browser = await getBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) return route.abort();
      return route.continue();
    });

    await login(page);

    for (const nd of withMemberId) {
      try {
        results[nd.id] = await scrapeMemberAppointments(page, nd.member_id as string);
      } catch (e) {
        errors[nd.id] = e instanceof Error ? e.message : String(e);
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  if (Object.keys(errors).length) {
    return NextResponse.json({ ok: false, error: 'Scrape errors — aborted before touching DB', errors }, { status: 500 });
  }

  const ndIdsToRebuild = withMemberId.map(n => n.id);
  const { error: delErr } = await supabase.from('nd_appointments').delete().in('nd_id', ndIdsToRebuild);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const toInsert: Record<string, unknown>[] = [];
  const summary: { name: string; count: number }[] = [];

  for (const nd of withMemberId) {
    const rows = results[nd.id] ?? [];
    const valid = rows.filter(r => r.role === 'Nominee Director' && !r.cessation.trim());
    summary.push({ name: nd.name, count: valid.length });
    for (const r of valid) {
      toInsert.push({
        nd_id: nd.id,
        company_name: r.company,
        sub_role: 'Nominee Director',
        appointment_date: parseDate(r.doapp),
        cessation_date: null,
      });
    }
  }

  if (toInsert.length) {
    const { error: insErr } = await supabase.from('nd_appointments').insert(toInsert);
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, totalInserted: toInsert.length, summary });
}
