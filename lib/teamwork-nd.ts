import type { Browser, BrowserContext, Page } from 'playwright-core';

const BASE = 'https://apps.teamworkcss.com/tassure_asia';

export type TeamworkNdPerson = { id: number; name: string; member_id: string };
export type TeamworkNdAppointment = {
  nd_id: number;
  company_name: string;
  appointment_date: string | null;
  cessation_date: string | null;
};

function parseDmy(value: string): string | null {
  const match = (value || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

async function launchBrowser(): Promise<Browser> {
  if (process.env.VERCEL) {
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

async function scrapeMember(
  context: BrowserContext,
  parserPage: Page,
  person: TeamworkNdPerson,
): Promise<TeamworkNdAppointment[]> {
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

  const rows = await parserPage.evaluate((html: string) => {
    const document = new DOMParser().parseFromString(`<table><tbody>${html}</tbody></table>`, 'text/html');
    return Array.from(document.querySelectorAll('tr')).flatMap(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(cell => (cell.textContent ?? '').trim());
      if (cells.length !== 5 || !cells[0] || cells[0] === 'Company Name') return [];
      return [{ company: cells[0], role: cells[1], appointment: cells[2], cessation: cells[3] }];
    });
  }, payload.res);

  return rows
    .filter(row => row.role === 'Nominee Director')
    .map(row => ({
      nd_id: person.id,
      company_name: row.company,
      appointment_date: parseDmy(row.appointment),
      cessation_date: parseDmy(row.cessation),
    }));
}

export async function scrapeTeamworkNdAppointments(people: TeamworkNdPerson[]) {
  let browser: Browser | null = null;
  const appointments: TeamworkNdAppointment[] = [];
  const errors: Array<{ person: string; error: string }> = [];
  const durations: Array<{ person: string; duration_ms: number }> = [];
  const concurrency = Math.min(3, Math.max(1, people.length));
  const overallTimeoutMs = 275_000;

  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    await login(context);

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
              appointments.push(...await scrapeMember(context, parserPage, person));
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
  durations.sort((left, right) => right.duration_ms - left.duration_ms);
  return { appointments, errors, durations, concurrency };
}
