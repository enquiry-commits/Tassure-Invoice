const https = require('https');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const BASE_HOST = 'apps.teamworkcss.com';
const BASE_PATH = '/dev/apiservice';
const BASIC_USER = process.env.TEAMWORK_BASIC_USER;
const BASIC_PASS = process.env.TEAMWORK_BASIC_PASS;
const API_KEY = process.env.TEAMWORK_API_KEY;
const LOGIN_EMAIL = process.env.TEAMWORK_LOGIN_EMAIL;
const LOGIN_PASSWORD = process.env.TEAMWORK_LOGIN_PASSWORD;
if (!BASIC_USER || !BASIC_PASS || !API_KEY || !LOGIN_EMAIL || !LOGIN_PASSWORD) {
  console.error('Missing TEAMWORK_* env vars in .env.local');
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, '..', 'data', 'teamwork-api');
const COMPANIES_DIR = path.join(DATA_DIR, 'companies');
const COMPANIES_LIST_PATH = path.join(DATA_DIR, 'companies-list.json');
const OFFICIALS_PROGRESS_PATH = path.join(DATA_DIR, 'officials-progress.json');

for (const dir of [DATA_DIR, COMPANIES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function req(method, apiPath, { form, token } = {}) {
  return new Promise((resolve, reject) => {
    const basicAuth = Buffer.from(`${BASIC_USER}:${BASIC_PASS}`).toString('base64');
    const reqHeaders = {
      Authorization: `Basic ${basicAuth}`,
      'x-api-key': API_KEY,
      authtoken: token || '',
    };

    let body = null;
    if (form) {
      const boundary = '----teamworkboundary' + Date.now() + Math.random().toString(16).slice(2);
      const parts = [];
      for (const [k, v] of Object.entries(form)) {
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`);
      }
      parts.push(`--${boundary}--\r\n`);
      body = Buffer.from(parts.join(''), 'utf-8');
      reqHeaders['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      reqHeaders['Content-Length'] = body.length;
    }

    const options = { hostname: BASE_HOST, path: BASE_PATH + apiPath, method, headers: reqHeaders };
    const r = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function login() {
  const res = await req('POST', '/api/user_auth/login', {
    form: { memail: LOGIN_EMAIL, mpassword: LOGIN_PASSWORD },
  });
  const json = JSON.parse(res.body);
  if (!json.token) throw new Error('Login failed: ' + res.body.slice(0, 300));
  return json.token;
}

async function fetchAllCompanies(token) {
  const pageSize = 100;
  let start = 0;
  let total = Infinity;
  const all = [];
  while (start < total) {
    const res = await req('POST', '/api/corpsec/companies/getCompanies', {
      token,
      form: { start: String(start), length: String(pageSize) },
    });
    const json = JSON.parse(res.body);
    total = json.data.recordsTotal;
    const batch = json.data.data.companyinfo;
    all.push(...batch);
    console.log(`  fetched companies ${start}-${start + batch.length} / ${total}`);
    start += pageSize;
    if (batch.length === 0) break;
  }
  return all;
}

function loadProgress() {
  if (fs.existsSync(OFFICIALS_PROGRESS_PATH)) {
    return JSON.parse(fs.readFileSync(OFFICIALS_PROGRESS_PATH, 'utf-8'));
  }
  return { completed: [], failed: [] };
}

function saveProgress(progress) {
  fs.writeFileSync(OFFICIALS_PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

async function fetchOfficialsForCompany(token, companyId) {
  const res = await req('GET', `/api/corpsec/companies/getOfficials?company_id=${companyId}`, { token });
  const json = JSON.parse(res.body);
  if (!json.status) throw new Error('API error: ' + res.body.slice(0, 200));
  return json.data.officials;
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;

  console.log('Logging in...');
  const token = await login();
  console.log('Login OK.');

  console.log('Fetching full companies list...');
  const companies = await fetchAllCompanies(token);
  fs.writeFileSync(COMPANIES_LIST_PATH, JSON.stringify(companies, null, 2));
  console.log(`Saved ${companies.length} companies to ${COMPANIES_LIST_PATH}`);

  const progress = loadProgress();
  const completedSet = new Set(progress.completed);

  let targets = companies.filter((c) => !completedSet.has(c.company_id));
  targets = targets.slice(0, LIMIT);
  console.log(`\nFetching officials for ${targets.length} companies (${completedSet.size} already done)...`);

  const t0 = Date.now();
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < targets.length; i++) {
    const c = targets[i];
    try {
      const officials = await fetchOfficialsForCompany(token, c.company_id);
      const outPath = path.join(COMPANIES_DIR, `${c.company_id}.json`);
      fs.writeFileSync(outPath, JSON.stringify({ company_id: c.company_id, company_name: c.company_name, officials }, null, 2));
      progress.completed.push(c.company_id);
      ok++;
    } catch (e) {
      progress.failed.push({ company_id: c.company_id, error: e.message });
      fail++;
      console.log(`  FAIL company_id=${c.company_id}: ${e.message}`);
    }
    if ((i + 1) % 50 === 0 || i === targets.length - 1) {
      saveProgress(progress);
      const elapsed = (Date.now() - t0) / 1000;
      console.log(`  [${i + 1}/${targets.length}] ok=${ok} fail=${fail} elapsed=${elapsed.toFixed(1)}s`);
    }
  }

  saveProgress(progress);
  const elapsed = (Date.now() - t0) / 1000;
  console.log(`\nDone. OK: ${ok}, Failed: ${fail}, Elapsed: ${elapsed.toFixed(1)}s`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
