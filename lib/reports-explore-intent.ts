// Plain-language -> Explore settings (2026-10-06). The model only PROPOSES
// settings; this file decides what is allowed to reach the screen. It never
// computes a number — every count on the page still comes from the existing
// client-side Explore logic over the real roster. No imports on purpose: used
// by both the API route and the browser, and testable on its own.

export const EXPLORE_DIMENSIONS = ['companyType', 'ssic', 'customerSource', 'twStatus', 'pic', 'clientSince', 'referrer', 'rm'] as const;
export const EXPLORE_METRICS = ['count', 'usesAddress', 'hasNd', 'hasAgm', 'hasXbrl', 'hasAccounts', 'hasTax'] as const;
export type ExploreDimension = (typeof EXPLORE_DIMENSIONS)[number];
export type ExploreMetric = (typeof EXPLORE_METRICS)[number];

export type ExplorePlan = {
  dimension: ExploreDimension;
  metric: ExploreMetric;
  view: 'summary' | 'list';
  sinceFrom: string; // 'YYYY-MM' or ''
  sinceTo: string;   // 'YYYY-MM' or ''
  filters: Partial<Record<ExploreDimension, string[]>>;
};

// What the model returns (OpenAI strict schema: every field present, nullable when unused).
export type IntentModelOutput = {
  action: 'apply' | 'clarify';
  question: string | null;
  dimension: string | null;
  metric: string | null;
  view: string | null;
  sinceFrom: string | null;
  sinceTo: string | null;
  filters: { dimension: string; values: string[] }[];
  restate: string;
  assumed: string[];
};

export type IntentResult =
  | { type: 'plan'; plan: ExplorePlan; restate: string; assumed: string[]; ignored: string[] }
  | { type: 'clarify'; question: string; choices: string[] };

export const MAX_REQUEST_CHARS = 500;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const hasCjk = (s: string) => /[一-鿿]/.test(s);

const DIM_LABEL_EN: Record<ExploreDimension, string> = {
  companyType: 'Company Type', ssic: 'SSIC Industry', customerSource: 'Customer Source', twStatus: 'Roster Status',
  pic: 'Secretary PIC', clientSince: 'Client Since', referrer: 'Referred By', rm: 'RM',
};

const norm = (s: string) => s.trim().toLowerCase();

// Real values that plausibly mean what the user typed — shown as tap-to-pick choices.
function nearest(wanted: string, values: string[]): string[] {
  const w = norm(wanted);
  const tokens = w.split(/[\s,.\-_/]+/).filter(t => t.length >= 2);
  const scored = values
    .filter(v => !/^not (recorded|assigned)$/i.test(v))
    .map(v => {
      const n = norm(v);
      let score = 0;
      if (n.includes(w) || w.includes(n)) score += 5;
      for (const t of tokens) if (n.includes(t)) score += 1;
      return { v, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.v.localeCompare(b.v));
  return scored.slice(0, 4).map(x => x.v);
}

export function resolveIntent(out: IntentModelOutput, options: Record<string, string[]>, userText: string): IntentResult {
  const zh = hasCjk(userText);
  const clarify = (question: string, choices: string[] = []): IntentResult => ({ type: 'clarify', question, choices });

  if (out.action === 'clarify') {
    return clarify(out.question?.trim() || (zh ? '我没完全理解，能再具体一点吗？' : 'I didn’t fully understand — could you be more specific?'));
  }

  const dimension = out.dimension as ExploreDimension | null;
  if (!dimension || !EXPLORE_DIMENSIONS.includes(dimension)) {
    return clarify(zh ? '想按什么来分组？例如：介绍人、RM、行业、公司类型、客户来源。' : 'What should I group by? For example: referrer, RM, industry, company type, customer source.',
      ['Referred By', 'RM', 'SSIC Industry', 'Company Type']);
  }
  const metric: ExploreMetric = out.metric && (EXPLORE_METRICS as readonly string[]).includes(out.metric) ? (out.metric as ExploreMetric) : 'count';
  const view: 'summary' | 'list' = out.view === 'list' ? 'list' : 'summary';

  const sinceFrom = out.sinceFrom ?? '';
  const sinceTo = out.sinceTo ?? '';
  for (const m of [sinceFrom, sinceTo]) {
    if (m && !MONTH_RE.test(m)) return clarify(zh ? `日期“${m}”我读不懂，请说具体的年月，例如 2026年1月。` : `I can’t read the date “${m}” — please give a month, e.g. January 2026.`);
  }
  if (sinceFrom && sinceTo && sinceFrom > sinceTo) {
    return clarify(zh ? `起始月份（${sinceFrom}）晚于结束月份（${sinceTo}），请确认。` : `The start month (${sinceFrom}) is after the end month (${sinceTo}) — please confirm.`);
  }

  const filters: ExplorePlan['filters'] = {};
  const ignored: string[] = [];
  for (const f of out.filters ?? []) {
    const dim = f.dimension as ExploreDimension;
    if (!EXPLORE_DIMENSIONS.includes(dim)) { ignored.push(f.dimension); continue; }
    if (dim === 'clientSince') { ignored.push(DIM_LABEL_EN.clientSince + (zh ? '（请用月份范围）' : ' (use the month range)')); continue; }
    const allowed = options[dim] ?? [];
    const byKey = new Map(allowed.map(v => [norm(v), v]));
    const matched: string[] = [];
    for (const raw of f.values ?? []) {
      const hit = byKey.get(norm(raw));
      if (hit) { if (!matched.includes(hit)) matched.push(hit); continue; }
      // A value that isn't in the real list is never applied silently.
      const near = nearest(raw, allowed);
      const label = DIM_LABEL_EN[dim];
      return clarify(
        zh ? `${label} 里没有“${raw}”。${near.length ? '你是指下面哪一个？' : '请换一个说法，或在“Only include”里直接挑选。'}`
           : `There is no “${raw}” under ${label}. ${near.length ? 'Did you mean one of these?' : 'Try another wording, or pick it under “Only include”.'}`,
        near.map(n => `${label}: ${n}`),
      );
    }
    if (matched.length) filters[dim] = matched;
  }

  return {
    type: 'plan',
    plan: { dimension, metric, view, sinceFrom, sinceTo, filters },
    restate: out.restate?.trim() || '',
    assumed: (out.assumed ?? []).filter(Boolean).slice(0, 5),
    ignored,
  };
}

// JSON schema handed to OpenAI (strict: every property required, no extras).
export const INTENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'question', 'dimension', 'metric', 'view', 'sinceFrom', 'sinceTo', 'filters', 'restate', 'assumed'],
  properties: {
    action: { type: 'string', enum: ['apply', 'clarify'] },
    question: { type: ['string', 'null'] },
    dimension: { type: ['string', 'null'], enum: [...EXPLORE_DIMENSIONS, null] },
    metric: { type: ['string', 'null'], enum: [...EXPLORE_METRICS, null] },
    view: { type: ['string', 'null'], enum: ['summary', 'list', null] },
    sinceFrom: { type: ['string', 'null'] },
    sinceTo: { type: ['string', 'null'] },
    filters: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['dimension', 'values'],
        properties: { dimension: { type: 'string', enum: [...EXPLORE_DIMENSIONS] }, values: { type: 'array', items: { type: 'string' } } },
      },
    },
    restate: { type: 'string' },
    assumed: { type: 'array', items: { type: 'string' } },
  },
} as const;
