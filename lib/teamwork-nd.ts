import type { Browser, BrowserContext, Page } from 'playwright-core';
import { removeStalePlaywrightTempDirs, withPlaywrightRetry } from './playwright-tmp-cleanup';

const BASE = 'https://apps.teamworkcss.com/tassure_asia';

export type TeamworkNdPerson = { id: number; name: string; member_id: string };
export type TeamworkNdAppointment = {
  nd_id: number;
  company_name: string;
  appointment_date: string | null;
  cessation_date: string | null;
};

export type TeamworkNdSubroleReview = {
  nd_id: number;
  nd_name: string;
  company_name: string;
  appointment_date: string;
  appointment_status: 'effective' | 'proposed' | 'unknown';
};

function parseDmy(value: string): string | null {
  const match = (value || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function appointmentStatus(value: string): TeamworkNdSubroleReview['appointment_status'] {
  if (/\(effective\)/i.test(value)) return 'effective';
  if (/\(proposed\)/i.test(value)) return 'proposed';
  return 'unknown';
}

async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
    // Vincent, 2026-08-29: this launch never swept its own leftover /tmp
    // profiles the way lib/teamwork-agm.ts's getBrowser() already does —
    // sync-nd now runs a full browser session twice a day (see this
    // route's own batching), silently contributing to the same shared
    // /tmp pool that was found causing teamwork_companies' real failures.
    await removeStalePlaywrightTempDirs();
    const chromium = (await import('@sparticuz/chromium')).default;
    const { chromium: playwrightChromium } = await import('playwright-core');
    return playwrightChromium.launch({
      args: [...chromium.args, '--disable-dev-shm-usage'],
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  const { chromium } = await import('playwright');
  return chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  }) as unknown as Browser;
}

async function login(context: BrowserContext) {
  const username = process.env.TEAMWORK_USERNAME;
  const password = process.env.TEAMWORK_PASSWORD;
  if (!username || !password) throw new Error('TEAMWORK_USERNAME and TEAMWORK_PASSWORD are required.');

  const page = await context.newPage();
  try {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (page.url().includes('welcome')) {
      await page.getByRole('textbox', { name: 'Username' }).fill(username);
      await page.getByRole('textbox', { name: 'Password' }).fill(password);
      await page.getByRole('button', { name: ' Login' }).click();
      await page.waitForURL('**/dashboard**', { timeout: 20_000, waitUntil: 'domcontentloaded' });
    }
  } finally {
    await page.close().catch(() => undefined);
  }
}

// 2026-08-31: the launch+context+login unit, wrapped by withPlaywrightRetry
// below (lib/playwright-tmp-cleanup.ts) — real evidence
// (docs/INVARIANTS.md INV-CRON-013) that two different Playwright-launching
// cron invocations can genuinely collide despite every cron entry sitting
// on its own distinct hour. Self-contained: closes its OWN browser on any
// failure before the retry wrapper tries again, so a failed attempt never
// leaks a browser process while the caller's outer `browser` variable is
// still null.
async function acquireNdSession(): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser = await launchBrowser();
  try {
    const context = await browser.newContext();
    await login(context);
    return { browser, context };
  } catch (error) {
    await browser.close().catch(() => undefined);
    throw error;
  }
}

async function scrapeMember(
  context: BrowserContext,
  parserPage: Page,
  person: TeamworkNdPerson,
): Promise<{
  appointments: TeamworkNdAppointment[];
  missingSubroles: TeamworkNdSubroleReview[];
}> {
  // The member page exposes this endpoint for its status selector. Calling it
  // directly avoids rendering the full member profile for every ND (roughly
  // 15-50 seconds of unnecessary browser work per person).
  const response = await context.request.post(`${BASE}/mainadmin/ajax_get_appointment_history_status`, {
    // Match TeamWork's default Active/Dormant portfolio. `status: 0` also
    // returns terminated-company rows whose ND cessation was never closed,
    // which would incorrectly inflate the current appointment count.
    form: { status: '1', member_id: person.member_id },
    timeout: 60_000,
    failOnStatusCode: false,
  });
  if (!response.ok()) throw new Error(`TeamWork appointment history HTTP ${response.status()}.`);

  const payload = await response.json() as { res?: unknown };
  if (typeof payload.res !== 'string' || !payload.res.includes('DIRECTOR HISTORY')) {
    throw new Error('TeamWork appointment history returned an unexpected response.');
  }

  // The Controller History table is a separate registration (Singapore
  // beneficial-ownership/significant-control status) from a Director History
  // subrole. It's already present in this same response at no extra fetch
  // cost, and a company appearing there means this person's role at that
  // company is accounted for even when the Director History row's own
  // Subrole text was never filled in — Chen De's Beltroad appointment has a
  // blank Subrole on his profile page but a standing Controller History
  // entry, confirmed against TeamWork's live data.
  const parsed = await parserPage.evaluate((html: string) => {
    const doc = new DOMParser().parseFromString(`<table><tbody>${html}</tbody></table>`, 'text/html');
    const headers = Array.from(doc.querySelectorAll('th, strong, b'));

    const directorHeader = headers.find(el => (el.textContent ?? '').trim().toUpperCase() === 'DIRECTOR HISTORY');
    const directorTable = directorHeader ? directorHeader.closest('table') : null;
    if (!directorTable) return null;
    const directorRows = Array.from(directorTable.querySelectorAll('tr')).flatMap(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(cell => (cell.textContent ?? '').trim());
      if (cells.length !== 5 || !cells[0] || cells[0] === 'Company Name') return [];
      return [{ company: cells[0], role: cells[1], appointment: cells[2], cessation: cells[3] }];
    });

    const controllerHeader = headers.find(el => (el.textContent ?? '').trim().toUpperCase() === 'CONTROLLER HISTORY');
    const controllerTable = controllerHeader ? controllerHeader.closest('table') : null;
    const controllerCompanies = controllerTable
      ? Array.from(controllerTable.querySelectorAll('tr')).flatMap(row => {
          const cells = Array.from(row.querySelectorAll('td')).map(cell => (cell.textContent ?? '').trim());
          if (!cells[0] || cells[0] === 'Company Name') return [];
          return [cells[0]];
        })
      : [];

    return { directorRows, controllerCompanies };
  }, payload.res);
  if (parsed === null) throw new Error('TeamWork appointment history: could not locate the Director History table.');
  const { directorRows: rows, controllerCompanies } = parsed;
  const controllerCompanySet = new Set(controllerCompanies.map(name => name.trim().toUpperCase()));

  const appointments = rows
    .filter(row => row.role === 'Nominee Director')
    .map(row => ({
      nd_id: person.id,
      company_name: row.company,
      appointment_date: parseDmy(row.appointment),
      cessation_date: parseDmy(row.cessation),
    }));

  // A blank role with an appointment date and no cessation date is not
  // promoted into the active ND portfolio automatically: it is recorded for
  // a person to confirm and repair in TeamWork first — unless this person is
  // already that company's registered Controller.
  const candidates = rows.flatMap(row => {
    if (controllerCompanySet.has(row.company.trim().toUpperCase())) return [];
    const appointmentDate = parseDmy(row.appointment);
    const subroleIsBlank = row.role.trim() === '';
    const hasEffectiveAppointment = /\(effective\)/i.test(row.appointment) && !!appointmentDate;
    const cessationIsBlank = row.cessation.trim() === '';
    if (!subroleIsBlank || !hasEffectiveAppointment || !cessationIsBlank) return [];
    return [{
      nd_id: person.id,
      nd_name: person.name,
      company_name: row.company,
      appointment_date: appointmentDate,
      appointment_status: appointmentStatus(row.appointment),
    } satisfies TeamworkNdSubroleReview];
  });

  // The AJAX status-selector endpoint's Role value can be stale: it reports
  // blank for appointments whose real Subrole (visible on the member's own
  // profile page) is "Controller", not "Nominee Director" and not empty.
  // Re-verify only the small candidate set against the profile page — the
  // field TeamWork's staff actually read from — rather than trusting the
  // AJAX blank, and rather than paying the full-page-load cost for every ND.
  if (candidates.length === 0) return { appointments, missingSubroles: [] };

  // A profile-page verification failure must not lose the appointments
  // already fetched above for this person. Fall back to the unverified
  // candidates (the previous, pre-Controller-check behaviour) rather than
  // failing the whole person and retrying the (already-succeeded) AJAX call.
  try {
    // A plain GET for the profile HTML, like the AJAX POST above, avoids a
    // full browser page render (CSS/JS/images) that made this step slow and
    // occasionally time out when done via page.goto.
    const profileResponse = await context.request.get(`${BASE}/view_member/${person.member_id}/?v`, {
      timeout: 45_000,
      failOnStatusCode: false,
    });
    if (!profileResponse.ok()) throw new Error(`TeamWork member profile HTTP ${profileResponse.status()}.`);
    const profileHtml = await profileResponse.text();

    const profileRows = await parserPage.evaluate((html: string) => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const headerEl = Array.from(doc.querySelectorAll('th, strong, b'))
        .find(el => (el.textContent ?? '').trim().toUpperCase() === 'DIRECTOR HISTORY');
      const directorTable = headerEl ? headerEl.closest('table') : null;
      if (!directorTable) return null;
      const directRows = Array.from(directorTable.children).flatMap(child =>
        child.tagName === 'TBODY' ? Array.from(child.children) : [child]
      ).filter(el => el.tagName === 'TR');
      return directRows.flatMap(row => {
        const cells = Array.from(row.querySelectorAll(':scope > td')).map(cell => (cell.textContent ?? '').trim());
        if (cells.length < 4 || cells.length > 6 || !cells[0] || cells[0] === 'Company Name') return [];
        return [{ company: cells[0], role: cells[1] }];
      });
    }, profileHtml);
    if (profileRows === null) throw new Error('TeamWork member profile: could not locate the Director History table.');
    const realSubroleByCompany = new Map(
      profileRows.map(row => [row.company.trim().toUpperCase(), row.role.trim()]),
    );

    const missingSubroles = candidates.filter(item => {
      const realSubrole = realSubroleByCompany.get(item.company_name.trim().toUpperCase());
      return realSubrole === undefined || realSubrole === '';
    });

    return { appointments, missingSubroles };
  } catch {
    return { appointments, missingSubroles: candidates };
  }
}

export async function scrapeTeamworkNdAppointments(people: TeamworkNdPerson[]) {
  let browser: Browser | null = null;
  const appointments: TeamworkNdAppointment[] = [];
  const missingSubroles: TeamworkNdSubroleReview[] = [];
  const errors: Array<{ person: string; error: string }> = [];
  const durations: Array<{ person: string; duration_ms: number }> = [];
  // Concurrency 4+ made things slower and less reliable in testing — TeamWork
  // appears to throttle concurrent requests from the same session, not just
  // rate-limit per request.
  const concurrency = Math.min(3, Math.max(1, people.length));
  // Vincent, 2026-08-28: was 290_000 — only a 10-second margin before the
  // route's own maxDuration=300 hard kill (app/api/teamwork/sync-nd/route.ts).
  // Confirmed live on the Automation Health dashboard: teamwork_nd kept
  // showing "Previous run lease expired before completion" and a run stuck
  // in status='running' forever, even though this Promise.race SHOULD have
  // let withAutomationRun's own catch block mark the run failed and release
  // its lock cleanly. The remaining work after the race settles — the
  // `finally` block's browser.close() below, propagating the error back up
  // through this function's caller, then withAutomationRun's own DB writes —
  // all still has to happen within whatever's left of the 300s budget. 10
  // seconds was never enough of a margin for that (closing a real headless
  // Chromium process alone can take several seconds), so on a slow day
  // Vercel's hard kill was winning that race before cleanup ever finished —
  // silently, with no chance for this function's own error handling to run
  // at all. Widened to a real 60-second buffer instead of guessing at a
  // smaller nudge.
  const overallTimeoutMs = 240_000;

  try {
    const session = await withPlaywrightRetry(acquireNdSession);
    browser = session.browser;
    const context = session.context;

    let nextIndex = 0;
    const worker = async () => {
      const parserPage = await context.newPage();
      try {
        while (nextIndex < people.length) {
          const person = people[nextIndex++];
          const startedAt = Date.now();
          let completed = false;
          let lastError = 'Unknown TeamWork scrape error.';

          for (let attempt = 1; attempt <= 2 && !completed; attempt++) {
            try {
              const scraped = await scrapeMember(context, parserPage, person);
              appointments.push(...scraped.appointments);
              missingSubroles.push(...scraped.missingSubroles);
              completed = true;
            } catch (error) {
              lastError = error instanceof Error ? error.message : String(error);
              if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 750));
            }
          }

          durations.push({ person: person.name, duration_ms: Date.now() - startedAt });
          if (!completed) errors.push({ person: person.name, error: lastError.split('\n')[0] });
        }
      } finally {
        await parserPage.close().catch(() => undefined);
      }
    };

    const work = Promise.all(Array.from({ length: concurrency }, () => worker()));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`TeamWork ND scrape exceeded ${overallTimeoutMs / 1000} seconds.`)),
          overallTimeoutMs,
        );
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
  } finally {
    const browserToClose = browser as Browser | null;
    if (browserToClose) await browserToClose.close().catch(() => undefined);
  }

  appointments.sort((left, right) => left.nd_id - right.nd_id || left.company_name.localeCompare(right.company_name));
  const uniqueMissingSubroles = [...new Map(missingSubroles.map(item => [
    `${item.nd_id}|${item.company_name.trim().toUpperCase()}|${item.appointment_date}`,
    item,
  ])).values()].sort((left, right) =>
    right.appointment_date.localeCompare(left.appointment_date)
    || left.nd_name.localeCompare(right.nd_name)
    || left.company_name.localeCompare(right.company_name)
  );
  durations.sort((left, right) => right.duration_ms - left.duration_ms);
  return { appointments, missingSubroles: uniqueMissingSubroles, errors, durations, concurrency };
}
