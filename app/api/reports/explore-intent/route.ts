import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { openAIConfigured, openAIJson, openAIModel } from '@/lib/ai/openai';
import { INTENT_SCHEMA, MAX_REQUEST_CHARS, resolveIntent, type IntentModelOutput } from '@/lib/reports-explore-intent';

// POST /api/reports/explore-intent — turns one typed sentence (Chinese or
// English) into proposed Explore settings (lib/reports-explore-intent.ts).
// The model only proposes; the browser shows a Confirm card and applies the
// settings itself, and every count still comes from the existing Explore
// logic — nothing here computes or writes data. Same access gate as /api/
// reports (canViewReports). Sends the model only the dimension VALUE lists
// (industries, referrer/RM names, ...) — never company names or amounts.
//
// OpenAI, not Claude: Reports' AI moved to OpenAI on 2026-09-23 when the
// Anthropic credit ran out (lib/reports-narrative.ts) and that path is the
// one known to work for this page. Cheap router-class model, one short call,
// capped input (Vincent: don't waste tokens).
export const preferredRegion = 'sin1';

const MAX_VALUES_PER_DIM = 400;

const INSTRUCTIONS = `You turn one request about a company-secretarial firm's client roster into settings for a "group-by + filter" table. You only choose settings; you never compute numbers.

Dimensions (use these exact keys):
- companyType: legal entity type. ssic: SSIC industry. customerSource: where the client came from. twStatus: roster status. pic: secretary person in charge.
- clientSince: the month the company BECAME OUR CLIENT. "New clients" / 新客户 / 新进来的 always means this (never the incorporation date). It is a month RANGE (sinceFrom/sinceTo, 'YYYY-MM', inclusive), not a filter value.
- referrer: who referred the client (介绍人). rm: the Relationship Manager responsible for the client (RM).
Metrics: count (default: number of companies), usesAddress, hasNd (nominee director), hasAgm, hasXbrl, hasAccounts, hasTax — only when the user asks for "companies with <service>".
view: "list" when the user wants to SEE the companies or asks who/which companies (with referrer/RM etc.); "summary" when they ask how many / a breakdown / "by X".

Rules:
- Today's date is given. "今年/this year" = January of the current year through now (sinceFrom = YYYY-01, sinceTo = null). "X月以后/since X" includes month X. "去年/last year" = that whole year. Always output YYYY-MM.
- filters: use ONLY values copied exactly from the provided options for that dimension. If the user names a person/industry, pick the matching option verbatim. If you cannot find it in the options, still output the name as the user said it (the server will check and ask) — never invent a different spelling.
- If the request is genuinely ambiguous or missing what to show, return action "clarify" with ONE short question in the user's language. Otherwise return action "apply" and prefer making a sensible choice over asking.
- restate: one plain sentence in the user's own language saying what will be shown. assumed: short phrases (user's language) for anything you chose that the user did NOT say (e.g. "按 Client Since 理解新客户", "默认统计公司数量").
- Reply in the user's language (Chinese or English) for question/restate/assumed.`;

export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewReports) return NextResponse.json({ error: 'Your account cannot use Reports.' }, { status: 403 });
  if (!openAIConfigured()) return NextResponse.json({ error: 'The AI helper is not configured.' }, { status: 503 });

  let body: { text?: unknown; today?: unknown; options?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return NextResponse.json({ error: 'Type what you want to see.' }, { status: 400 });
  if (text.length > MAX_REQUEST_CHARS) return NextResponse.json({ error: `Please keep it under ${MAX_REQUEST_CHARS} characters.` }, { status: 400 });
  const today = typeof body.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);

  const options: Record<string, string[]> = {};
  if (body.options && typeof body.options === 'object') {
    for (const [dim, vals] of Object.entries(body.options as Record<string, unknown>)) {
      if (Array.isArray(vals)) options[dim] = vals.filter((v): v is string => typeof v === 'string').slice(0, MAX_VALUES_PER_DIM);
    }
  }

  try {
    const out = await openAIJson<IntentModelOutput>({
      instructions: INSTRUCTIONS,
      input: JSON.stringify({ today, request: text, options }),
      schemaName: 'explore_intent',
      schema: INTENT_SCHEMA as unknown as Record<string, unknown>,
      accountEmail: account.email,
      model: openAIModel('router'),
      maxOutputTokens: 700,
      timeoutMs: 25_000,
      usage: { feature: 'reports_explore', trigger: 'chat', actorEmail: account.email ?? null },
    });
    return NextResponse.json({ result: resolveIntent(out, options, text) });
  } catch (err) {
    console.error('explore-intent failed:', err);
    return NextResponse.json({ error: 'The AI helper could not answer just now — please use a Quick view.' }, { status: 502 });
  }
}
