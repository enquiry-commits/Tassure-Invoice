import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { normalize } from '@/lib/company-name';

/**
 * In-app AI assistant: answers questions about the system, looks up live data
 * (companies / nominee directors / AR batches), and hands back links that the
 * chat widget renders as navigation buttons.
 *
 * Two engines:
 *  - ANTHROPIC_API_KEY set   → Claude (tool-use loop over the data tools below)
 *  - no key                  → built-in intent engine (keyword routing over the
 *                              same data tools; navigation + FAQ still work)
 */

export const maxDuration = 60;

type Msg = { role: 'user' | 'assistant'; content: string };

// ── System map: single source for both engines ──────────────────────────────
const PAGES = [
  { label: 'Dashboard 总览',        href: '/',                          kw: ['dashboard', '总览', '首页', 'overview', '主页'] },
  { label: 'Companies 公司库',      href: '/companies',                 kw: ['companies', '公司库', '公司列表', '所有公司'] },
  { label: 'Active Client 在任客户', href: '/master-list/active-clients', kw: ['active client', '在任客户', 'master list', '主名单'] },
  { label: 'Ad-Hoc',                href: '/master-list/ad-hoc',        kw: ['ad-hoc', 'ad hoc', '临时'] },
  { label: 'MAS',                   href: '/master-list/mas',           kw: ['mas'] },
  { label: 'Strike Off',            href: '/master-list/strike-off',    kw: ['strike off', 'strike-off', '除名'] },
  { label: 'Terminated Services',   href: '/master-list/terminated',    kw: ['terminated', '终止'] },
  { label: 'Change Co Name',        href: '/master-list/name-change',   kw: ['name change', '改名', 'change co name'] },
  { label: 'Inactive Old Record',   href: '/master-list/inactive-old',  kw: ['inactive', '旧记录'] },
  { label: 'Nominee Directors 提名董事', href: '/nominee-directors',    kw: ['nominee', 'nd', '提名董事', '挂名董事'] },
  { label: 'Address Service 地址服务', href: '/address-service',        kw: ['address', '地址'] },
  { label: 'AR Reminder 年报提醒',  href: '/billing?tab=ar',            kw: ['ar reminder', 'ar', '年报', 'annual return', '提醒'] },
  { label: 'Late Filing 迟报监控',  href: '/late-filing',               kw: ['late filing', '迟报', 'late'] },
  { label: 'Billing Drafts 开单草稿', href: '/billing?tab=billing',     kw: ['billing', '开单', '发票', 'invoice', 'draft', '账单'] },
];

const FAQ: { kw: string[]; a: string }[] = [
  { kw: ['怎么开单', '如何开单', '生成发票', 'how to invoice', '怎么生成', '开发票'],
    a: '开单流程:进入 [Billing Drafts 开单草稿](/billing?tab=billing) → 选 FYE 月份/年份 → 点开公司行,系统已按上一年发票预填服务项和真实费用(折扣会自动带入并提醒确认)→ 核对后点 "Generate Invoice in QuickBooks"。发票只会创建为 QB 草稿,不会自动发给客户。' },
  { kw: ['ar 流程', 'ar是什么', 'ar reminder是什么', '年报流程', '年报是什么'],
    a: 'AR Reminder 是年报申报追踪:TeamWork 判定每家公司的 FYE 周期 → 系统每天自动生成未来 6 个月的提醒批次 → 人工审核 → 到期进入 Billing 开单。删除某家公司后它不会被自动加回(软删除),用 Add Manual 可恢复。' },
  { kw: ['删除', '移除公司', '不要这家', 'exclude', '排除'],
    a: '在 [AR Reminder](/billing?tab=ar) 删除公司是"软删除":列表里消失,且每日自动生成不会把它加回来。以后想恢复,用 Add Manual 重新添加同一家即可自动还原。' },
  { kw: ['late filing是什么', '迟报是什么', '怎么算迟报'],
    a: 'Late Filing 每天自动检测:当前周期逾期超过 90 天,或历史平均(完成日−到期日)超过 90 天的公司会被标记,进入 [Late Filing 迟报监控](/late-filing)。' },
  { kw: ['nd同步', 'nd更新', '提名董事同步', 'nd多久'],
    a: 'ND 提名董事数据每天早上 8 点从 TeamWork 自动同步(电脑当时没开会在开机后补跑)。当前在任任命以 TeamWork「Company Appointments」为准。查询请到 [Nominee Directors](/nominee-directors),支持按公司名搜索。' },
  { kw: ['qb同步', 'quickbooks同步', '发票数据多久', '数据多久更新'],
    a: 'QuickBooks 发票数据每天凌晨 1:30 自动同步(今年+去年全量)。AR 批次每天凌晨 1 点滚动生成,Late Filing 每天凌晨 3 点检测。' },
];

// ── Data tools (shared by both engines) ─────────────────────────────────────
async function searchCompany(q: string) {
  const sb = createAdminClient();
  const like = `%${q.trim()}%`;
  const { data: comps } = await sb.from('companies')
    .select('company_name, registration_no, fye_month, tw_status, client_type, is_active, uses_address, has_nd, has_xbrl, pic, sec_pic, internal_id')
    .ilike('company_name', like).limit(5);
  if (!comps?.length) return { found: false as const };
  const results = [];
  for (const c of comps) {
    const { data: nds } = await sb.from('nd_appointments')
      .select('nd_id, appointment_date')
      .ilike('company_name', `%${normalize(c.company_name).split(' ').slice(0, 3).join('%')}%`)
      .eq('sub_role', 'Nominee Director').is('cessation_date', null).limit(3);
    let ndNames: string[] = [];
    if (nds?.length) {
      const { data: people } = await sb.from('nominee_directors').select('id, name').in('id', nds.map(n => n.nd_id));
      ndNames = (people ?? []).map(p => p.name);
    }
    const { data: ar } = await sb.from('ar_reminder')
      .select('fye_month, fye_year, status, due_date')
      .ilike('entity_name', like).order('fye_year', { ascending: false }).limit(2);
    results.push({
      name: c.company_name, uen: c.registration_no, fye_month: c.fye_month,
      status: c.tw_status, client_type: c.client_type, active: c.is_active,
      services: { address: !!c.uses_address, nd: !!c.has_nd, xbrl: !!c.has_xbrl },
      pic: c.sec_pic ?? c.pic, nominee_directors: ndNames,
      ar_reminders: (ar ?? []).map(r => `${r.fye_month} ${r.fye_year} (${r.status ?? 'Pending'}, due ${r.due_date ?? '?'})`),
    });
  }
  return { found: true as const, companies: results };
}

async function arBatch(month: string, year: number) {
  const sb = createAdminClient();
  const { data } = await sb.from('ar_reminder')
    .select('entity_name, status, due_date')
    .eq('fye_month', month).eq('fye_year', year)
    .or('status.is.null,status.neq.Excluded');
  const rows = data ?? [];
  return {
    month, year, total: rows.length,
    filed: rows.filter(r => r.status === 'Filed').length,
    pending: rows.filter(r => !r.status || r.status === 'Pending').length,
    companies: rows.slice(0, 40).map(r => r.entity_name),
  };
}

async function ndLookup(name: string) {
  const sb = createAdminClient();
  const { data: people } = await sb.from('nominee_directors').select('id, name').ilike('name', `%${name.trim()}%`).limit(3);
  if (!people?.length) return { found: false as const };
  const out = [];
  for (const p of people) {
    const { data: appts } = await sb.from('nd_appointments')
      .select('company_name, appointment_date')
      .eq('nd_id', p.id).eq('sub_role', 'Nominee Director').is('cessation_date', null)
      .order('appointment_date', { ascending: false });
    out.push({ name: p.name, active_count: appts?.length ?? 0, companies: (appts ?? []).map(a => `${a.company_name} (since ${a.appointment_date})`) });
  }
  return { found: true as const, directors: out };
}

// ── Engine A: Claude with tool use ───────────────────────────────────────────
const SYSTEM_PROMPT = `You are the in-app assistant of the Tassure Corporate Services System (a Singapore corporate-services billing dashboard used by Tassure Asia staff). Answer in the user's language (usually Chinese). Be concise and concrete.

System map (link pages with markdown, e.g. [开单草稿](/billing?tab=billing)):
${PAGES.map(p => `- ${p.label}: ${p.href}`).join('\n')}

Key workflows:
- AR pipeline: TeamWork determines each company's FYE cycle → ar_reminder batches auto-generate daily (rolling 6 months) → staff review → Billing Drafts. Deleting an AR row is a soft delete (won't be auto-recreated; Add Manual restores it).
- Billing Drafts: per company, pre-filled from the prior year's invoice (true annual fee incl. deferred-revenue split; discounts carried forward flagged for confirmation; ND presence trusted from TeamWork; XBRL must be confirmed each FY). "Generate Invoice in QuickBooks" creates a DRAFT in QB — never auto-sent.
- Data freshness: QB invoices sync daily 01:30 (current+previous year); AR batches generate daily 01:00; Late Filing detects daily 03:00 (overdue>90d or historical avg gap>90d); ND appointments sync daily 08:00 from TeamWork.

Use tools to answer data questions. If the user should go somewhere, include the markdown link. If you don't know, say so plainly.`;

const CLAUDE_TOOLS = [
  { name: 'search_company', description: 'Look up companies by (partial) name: status, FYE month, services, PIC, active nominee directors, recent AR reminder rows.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'ar_batch', description: 'AR Reminder batch for a FYE month+year: totals and company names.', input_schema: { type: 'object', properties: { month: { type: 'string', description: 'English month name, e.g. April' }, year: { type: 'number' } }, required: ['month', 'year'] } },
  { name: 'nd_lookup', description: 'Look up a nominee director by person name: their active company appointments.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
];

async function runTool(name: string, input: Record<string, unknown>) {
  if (name === 'search_company') return searchCompany(String(input.query ?? ''));
  if (name === 'ar_batch') return arBatch(String(input.month ?? ''), Number(input.year ?? 0));
  if (name === 'nd_lookup') return ndLookup(String(input.name ?? ''));
  return { error: 'unknown tool' };
}

async function claudeAnswer(messages: Msg[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const convo: Record<string, unknown>[] = messages.map(m => ({ role: m.role, content: m.content }));
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: SYSTEM_PROMPT, tools: CLAUDE_TOOLS, messages: convo }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const toolUses = (data.content as Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }>).filter(b => b.type === 'tool_use');
    if (!toolUses.length || data.stop_reason !== 'tool_use') {
      return (data.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text).join('\n') || '(无回复)';
    }
    convo.push({ role: 'assistant', content: data.content });
    const results = [];
    for (const tu of toolUses) {
      const result = await runTool(tu.name!, tu.input ?? {});
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 6000) });
    }
    convo.push({ role: 'user', content: results });
  }
  return '抱歉,这个问题查询步骤太多,请换个更具体的问法。';
}

// ── Engine B: built-in intent router (no API key required) ───────────────────
const MONTH_MAP: Record<string, string> = {
  '1月': 'January', '一月': 'January', jan: 'January', january: 'January',
  '2月': 'February', '二月': 'February', feb: 'February', february: 'February',
  '3月': 'March', '三月': 'March', mar: 'March', march: 'March',
  '4月': 'April', '四月': 'April', apr: 'April', april: 'April',
  '5月': 'May', '五月': 'May', may: 'May',
  '6月': 'June', '六月': 'June', jun: 'June', june: 'June',
  '7月': 'July', '七月': 'July', jul: 'July', july: 'July',
  '8月': 'August', '八月': 'August', aug: 'August', august: 'August',
  '9月': 'September', '九月': 'September', sep: 'September', september: 'September',
  '10月': 'October', '十月': 'October', oct: 'October', october: 'October',
  '11月': 'November', '十一月': 'November', nov: 'November', november: 'November',
  '12月': 'December', '十二月': 'December', dec: 'December', december: 'December',
};

async function intentAnswer(text: string): Promise<string> {
  const t = text.toLowerCase().trim();

  // 1. FAQ
  for (const f of FAQ) if (f.kw.some(k => t.includes(k))) return f.a;

  // 2. AR batch question: month (+year) + ar/开单 keywords
  const monthKey = Object.keys(MONTH_MAP).sort((a, b) => b.length - a.length).find(k => t.includes(k));
  if (monthKey && /(ar|年报|开单|reminder|billing|batch|批次|几家|多少)/.test(t)) {
    const yearMatch = t.match(/20\d{2}/);
    const year = yearMatch ? +yearMatch[0] : new Date().getFullYear();
    const b = await arBatch(MONTH_MAP[monthKey], year);
    if (!b.total) return `${MONTH_MAP[monthKey]} ${year} 还没有 AR Reminder 批次。到 [AR Reminder](/billing?tab=ar) 可切换月份查看或生成。`;
    return `**${MONTH_MAP[monthKey]} ${year} AR 批次:共 ${b.total} 家**(已申报 ${b.filed},待处理 ${b.pending})。\n前几家:${b.companies.slice(0, 8).join('、')}${b.total > 8 ? ' …' : ''}\n\n查看完整批次:[AR Reminder](/billing?tab=ar) · 去开单:[Billing Drafts](/billing?tab=billing)`;
  }

  // 3. Navigation: 去/打开/带我/open/go
  if (/(去|打开|带我|跳转|open |go to |进入)/.test(t)) {
    for (const p of PAGES) if (p.kw.some(k => t.includes(k))) return `好的,带你去 **${p.label}**:[点击打开](${p.href})`;
  }

  // 4. ND person lookup: "XX 有哪些公司 / 挂了几家"
  if (/(哪些公司|几家公司|挂名|任职|appointments)/.test(t)) {
    const nameGuess = text.replace(/有哪些公司|挂名|挂了几家公司?|任职|的|哪些|几家|公司|appointments|\?|？/g, '').trim();
    if (nameGuess.length >= 2) {
      const r = await ndLookup(nameGuess);
      if (r.found) {
        return r.directors.map(d => `**${d.name}** 当前在任 ${d.active_count} 家:\n${d.companies.slice(0, 12).map(c => '· ' + c).join('\n')}${d.active_count > 12 ? '\n…' : ''}`).join('\n\n') + `\n\n详情:[Nominee Directors](/nominee-directors)`;
      }
    }
  }

  // 5. Company lookup: try the raw text as a company name (≥3 chars)
  const cleaned = text.replace(/查|一下|公司|的资料|的信息|情况|status|是什么|谁|\?|？/g, ' ').trim();
  if (cleaned.length >= 3) {
    const r = await searchCompany(cleaned);
    if (r.found) {
      return r.companies.map(c => {
        const svcs = [c.services.address && '地址服务', c.services.nd && 'ND', c.services.xbrl && 'XBRL'].filter(Boolean).join(' + ') || '仅秘书';
        return `**${c.name}**\n· UEN:${c.uen ?? '—'} · 状态:${c.status ?? '—'}(${c.client_type ?? '—'})\n· FYE 月份:${c.fye_month ?? '未记录'} · PIC:${c.pic ?? '—'}\n· 服务:${svcs}${c.nominee_directors.length ? `\n· 在任 ND:${c.nominee_directors.join('、')}` : ''}${c.ar_reminders.length ? `\n· AR:${c.ar_reminders.join(';')}` : ''}`;
      }).join('\n\n') + `\n\n[Companies 公司库](/companies) · [Billing Drafts 开单](/billing?tab=billing)`;
    }
  }

  // 6. Fallback: capabilities
  return `我可以帮你:\n· **查公司**——直接输入公司名(如"INFINITY LINKS"),给你状态/FYE/服务/ND/年报进度\n· **查 ND**——如"CHEN DE 有哪些公司"\n· **查 AR 批次**——如"4月2026有几家AR"\n· **带你去页面**——如"打开开单草稿"\n· **流程问题**——如"怎么开单"、"删除的公司会回来吗"\n\n试着换个说法,或点这里浏览:${PAGES.slice(0, 5).map(p => `[${p.label}](${p.href})`).join(' · ')}`;
}

// ── Route ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { messages } = (await req.json().catch(() => ({}))) as { messages?: Msg[] };
  if (!messages?.length) return NextResponse.json({ error: 'messages required' }, { status: 400 });

  const last = messages[messages.length - 1];
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const reply = await claudeAnswer(messages.slice(-8));
      return NextResponse.json({ reply, engine: 'claude' });
    }
    const reply = await intentAnswer(last.content);
    return NextResponse.json({ reply, engine: 'intent' });
  } catch (e) {
    // Claude path failed (bad key / network) — degrade to the intent engine.
    try {
      const reply = await intentAnswer(last.content);
      return NextResponse.json({ reply, engine: 'intent-fallback', note: e instanceof Error ? e.message : 'claude failed' });
    } catch {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'assistant failed' }, { status: 500 });
    }
  }
}
