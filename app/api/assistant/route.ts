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
type AssistantContext = { pathname?: string; page?: string };

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
  { label: 'Nominee Directors 提名董事', href: '/nominee-directors',    kw: ['nominee', 'nd', '提名董事', '挂名董事'] },
  { label: 'Address Service 地址服务', href: '/address-service',        kw: ['address', '地址'] },
  { label: 'AR Reminder 年报提醒',  href: '/billing?tab=ar',            kw: ['ar reminder', 'ar', '年报', 'annual return', '提醒'] },
  { label: 'Late Filing 迟报监控',  href: '/late-filing',               kw: ['late filing', '迟报', 'late'] },
  { label: 'Billing Drafts 开单草稿', href: '/billing?tab=billing',     kw: ['billing', '开单', '发票', 'invoice', 'draft', '账单'] },
  { label: 'Email Drafts 邮件草稿', href: '/client-communications/campaigns', kw: ['email drafts', '邮件草稿', 'client communications', 'campaign', 'outlook helper'] },
  { label: 'Email Activity 邮件记录', href: '/client-communications/history', kw: ['email activity', '邮件记录', 'delivery history', 'history', 'prepared'] },
];

const FAQ: { kw: string[]; a: string }[] = [
  { kw: ['为什么这行还不能ready', '为什么不能ready', '还不能 ready', '不能勾选ready', 'status怎么看', 'item to review'],
    a: '**Email Drafts 的 Ready 条件**\n· 必须有有效的客户 To 邮箱\n· Fallback / No recipient source 必须由员工人工确认收件人\n· 必须有系统 Invoice 或员工手动加入的附件\n· Template 必填资料及 Outlook Sender 必须完整\n· Status 会逐项列出缺少内容；修正后再选择该行\n\n[打开 Email Drafts](/client-communications/campaigns)' },
  { kw: ['email drafts怎么用', '邮件草稿怎么用', '怎么准备邮件', '怎么生成邮件', 'outlook草稿流程', '邮件流程'],
    a: '**Email Drafts 流程**\n· 选择邮件类型、Template、FYE 月份/年份及 Outlook Sender\n· 核对每家公司 User Name、To、CC、Invoice / Files 与 Status\n· 只有资料完整且通过人工复核的行才可勾选为 Ready\n· 先确保 Outlook Helper 显示 Ready，再批量建立 Classic Outlook 草稿\n· 最后仍由员工逐封复核并在 Outlook 手动发送\n\n[打开 Email Drafts](/client-communications/campaigns)' },
  { kw: ['outlook helper', 'helper怎么用', 'helper没有准备好', 'helper not detected', 'helper未检测', 'helper下载'],
    a: '**Outlook Helper 使用方法**\n· 在 Email Drafts 顶部 Helper 区下载并打开 Helper\n· 保持 Helper 运行，并确认 Classic Outlook 已安装及可使用\n· 回到页面点 Recheck；状态显示 Ready 后才建立带附件的 Outlook 草稿\n· 显示 Not detected 时，可能是未安装，也可能是已关闭；重新打开后再检查\n\n[打开 Email Drafts](/client-communications/campaigns)' },
  { kw: ['to和cc', 'to / cc', '收件人规则', 'recipient规则', '邮件发给谁', 'cc规则'],
    a: '**Email Drafts 收件人规则**\n· 客户外部邮箱放 **To**，Tassure 内部邮箱放 **CC**\n· `cindy@tassure.com` 自动排除\n· `hoechyi@tassure.com` 必须保留在 CC\n· 当 `kahye@tassure.com` 出现时，不再加入 `sengxin@tassure.com`\n· TeamWork Report 是首选来源；Fallback 或缺少有效 To 时必须人工复核\n· 如业务需要，员工仍可在最终复核时追加其他客户 CC' },
  { kw: ['prepared后', 'prepared 之后', 'prepared去哪里', '已经prepared', '重新打开草稿', '重开outlook', '查看prepared'],
    a: '**查看已经 Prepared 的邮件**\n· 进入 [Email Activity](/client-communications/history)\n· 找到对应公司并点 View 查看完整内容、收件人及附件记录\n· 如需再次打开 Outlook 草稿，可用页面内的 Reopen 功能；Outlook Helper 必须处于 Ready\n· 删除这里只会删除系统内的活动记录，不会删除 Outlook 中已建立的草稿' },
  { kw: ['css client和shareholder', 'css client 和 shareholder', 'client类型怎么判断', 'internal css status', 'companies怎么判断'],
    a: '**Companies 判断标准**\n· 页面只纳入 TeamWork **Internal CSS Status = Active** 的公司\n· Client (CSS Client) 与 Shareholder 再根据 TeamWork Client column 的标记分类\n· 两个类型是额外分类，不会改变 Internal CSS Status 的 Active 入选标准\n· Active ND Companies 统计的是有在任 Nominee Director 的**公司数**，不是 ND 人数\n\n[打开 Companies](/companies)' },
  { kw: ['系统各页面', '页面有什么用途', '全部功能', '系统功能'],
    a: '**主要功能入口**\n· [Companies](/companies) — Active 公司、Client 类型与服务概况\n· [Active Client](/master-list/active-clients) — 客户主名单与详细资料\n· [Nominee Directors](/nominee-directors) / [Address Service](/address-service) — 服务名单\n· [AR Reminder](/billing?tab=ar) / [Billing Drafts](/billing?tab=billing) — 批次审核与 QB 开单\n· [Late Filing](/late-filing) — 迟报监控\n· [Email Drafts](/client-communications/campaigns) / [Email Activity](/client-communications/history) — Outlook 草稿准备与记录' },
  { kw: ['fye mismatch', '服务格子', 'service格子', '服务怎么判断'],
    a: '**Active Client 提示说明**\n· FYE Mismatch 表示系统名单中的 FYE 与当前 TeamWork 记录不同，需要人工核对来源\n· 服务格子由现有 TeamWork / 服务记录自动判断：绿色勾选代表有有效服务，灰色空格代表当前没有有效记录\n· 点击公司行可打开完整详情再确认，不应只凭列表图标修改外部系统' },
  { kw: ['nd数量会不同', 'nd数量不同', 'active nd companies是什么', 'active nd companies'],
    a: '**ND 数量口径**\n· Companies 的 Active ND Companies 是有至少一位在任 ND 的**公司数**\n· Nominee Directors 页面同时涉及 ND 人数与 appointment 记录数\n· 一位 ND 可服务多家公司，一家公司也可能有多段记录，所以不同卡片数字不应直接相等' },
  { kw: ['地址服务怎么判断', 'address service怎么判断', 'address service数据'],
    a: '**Address Service 判断**\n· 当前有效名单以 TeamWork 的地址服务资料为主要来源\n· QuickBooks 历史只能证明过去曾经收费，不应单独认定服务现在仍有效\n· 如公司详情与 TeamWork 不一致，应先核对来源记录，再等待下一轮 TeamWork Companies 同步' },
  { kw: ['开单后为什么不会自动发送', '为什么不会自动发送', 'invoice自动发送', '发票会自动发送吗'],
    a: '**开单与发送是两个独立步骤**\n· Billing Drafts 只在 QuickBooks 建立 Invoice 草稿并取得号码\n· 系统不会自动寄给客户，这是保留给审核人员的保险机制\n· 发票确认后，再到 [Email Drafts](/client-communications/campaigns) 准备收件人、内容和附件\n· Outlook 草稿建立后仍由员工做最后检查并手动发送' },
  { kw: ['服务期间怎么更新', 'period怎么更新', 'period没有更新', '照搬去年period', 'service period'],
    a: '**Service Period 更新**\n· 系统会从上一期可识别的服务期间推算下一周期，不是直接复制去年文字\n· Deferred Revenue 与对应 Secretary 服务按同类服务配对；界面只显示 Secretary 服务行\n· 无法安全解析、期间冲突或特殊描述会标示人工复核，不应静默猜测\n· 开单前仍需核对草稿中的起止日期' },
  { kw: ['怎么开单', '如何开单', '生成发票', 'how to invoice', '怎么生成', '开发票', '怎么开票', '如何开票', '怎么出单', '开单流程', '开票流程'],
    a: '**开单流程**\n· 进入 [Billing Drafts 开单草稿](/billing?tab=billing)\n· 选 FYE 月份 / 年份\n· 点开公司行——系统已按上一年发票预填服务项和真实费用(折扣自动带入并提醒确认)\n· 核对后点 "Generate Invoice in QuickBooks"\n\n发票只会创建为 QB 草稿,**不会自动发给客户**。' },
  { kw: ['ar 流程', 'ar是什么', 'ar reminder是什么', '年报流程', '年报是什么', '什么是ar', '什么是年报', 'ar怎么运作'],
    a: '**AR Reminder 年报追踪流程**\n· TeamWork 判定每家公司的 FYE 周期\n· 系统每天自动生成未来 6 个月的提醒批次\n· 人工审核批次\n· 到期进入 [Billing Drafts](/billing?tab=billing) 开单\n\n删除的公司不会被自动加回(软删除),用 Add Manual 可恢复。' },
  { kw: ['删除', '移除公司', '不要这家', 'exclude', '排除', '删掉', '去掉这家', '隐藏公司'],
    a: '**删除公司(软删除)**\n· 在 [AR Reminder](/billing?tab=ar) 删除后,列表里消失\n· 每日自动生成**不会**把它加回来\n· 想恢复:用 Add Manual 重新添加同一家,自动还原原记录' },
  { kw: ['恢复', '加回', 'add manual', '添加公司', '新增公司', '手动添加'],
    a: '**添加 / 恢复公司**\n· 在 [AR Reminder](/billing?tab=ar) 点 "Add Manual"\n· 如果这家公司之前被删除过(同月份+年份),会自动**恢复原记录**而不是新建重复' },
  { kw: ['late filing是什么', '迟报是什么', '怎么算迟报', '什么是迟报', '迟报标准', '迟报规则'],
    a: '**Late Filing 判定规则**(每天 08:00 SGT 自动检测)\n· 当前周期逾期超过 **90 天**,或\n· 历史平均(完成日 − 到期日)超过 **90 天**\n\n命中的公司进入 [Late Filing 迟报监控](/late-filing)。' },
  { kw: ['nd同步', 'nd更新', '提名董事同步', 'nd多久', 'nd数据'],
    a: '**ND 提名董事数据**\n· 每天 05:00 SGT 由 Vercel Cron 从 TeamWork 自动同步\n· 在任任命以 TeamWork「Company Appointments」为准\n· Dashboard Automation health 会显示最近成功时间；超过预期窗口应检查运行记录\n\n查询:[Nominee Directors](/nominee-directors),支持按公司名搜索。' },
  { kw: ['qb同步', 'quickbooks同步', '发票数据多久', '数据多久更新', '同步时间', '数据更新时间', '多久同步'],
    a: '**每日自动同步时间表**(新加坡时间)\n· 05:00 — TeamWork ND\n· 05:30 — TeamWork Companies / Campaign recipients\n· 06:00 — AR 批次滚动生成\n· 06:30 — QuickBooks 发票同步\n· 07:00 — AR Workflow\n· 08:00 — Late Filing\n\n实际是否成功应以 Dashboard Automation health 的最近成功时间及异常详情为准。' },
  { kw: ['xbrl是什么', '什么是xbrl', 'xbrl要不要', '要不要xbrl', 'xbrl需要吗', 'xbrl规则'],
    a: '**XBRL 处理规则**\n· 金额历史上 100% 稳定(有就是同一个价)\n· 但**是否需要**每年会变(取决于当年申报要求)\n· 所以草稿里 XBRL 行会标 "⚠ Confirm XBRL required this FY",需人工确认' },
  { kw: ['折扣', 'discount', '优惠'],
    a: '**折扣处理**\n· 上一年发票里的 Discount Given 会**自动带入**新草稿\n· 默认勾选,并标注 "confirm it still applies"\n· 不再适用就取消勾选即可' },
  { kw: ['fye是什么', '什么是fye', 'financial year', '财年'],
    a: '**FYE = Financial Year End(财年结束月份)**\n· 决定每家公司的 AR 年报周期\n· 也决定它出现在哪个月的开单批次\n· 开单一般在 FYE 月份后约 6 周进行' },
  { kw: ['已开单', '未开单', '没开单怎么看', 'to invoice', '哪些开过', '怎么看开单状态'],
    a: '**查看开单状态**\n· [Billing Drafts](/billing?tab=billing) 顶部有三张卡:全部 / To Invoice(待开)/ Invoiced(已开)\n· 判定依据是发票上的 FYE 周期标记,可点击卡片筛选\n· 每行公司名旁也有 "To invoice" / "✓ Invoiced" 徽章' },
  { kw: ['token', '授权过期', 'reconnect', 'qb授权', 'quickbooks连不上', 'qb报错'],
    a: '**QuickBooks 授权**\n· 顶栏右上有 QuickBooks 状态;授权临期会变黄色警告、过期变红色\n· 点它重新授权即可\n· 正常情况下每日自动同步会让授权持续续期,不会过期' },
  { kw: ['nd费用', 'nd收费', 'nd deposit', 'nd押金', '提名董事费'],
    a: '**ND 收费说明**\n· ND 是否要开单:以 TeamWork 在任记录为准(草稿自动勾选)\n· 金额要人工核对——因为**押金(deposit)和年费是分开开票的**,历史金额可能是押金\n· 草稿里 ND 行标注 "confirm annual fee (excl. deposit)"' },
];

function currentPageHelp(pathname = ''): string {
  if (pathname === '/client-communications/campaigns') {
    return FAQ[1].a;
  }
  if (pathname === '/client-communications/history') {
    return FAQ[4].a;
  }
  if (pathname === '/companies') {
    return FAQ[5].a;
  }
  if (pathname === '/nominee-directors') {
    return '**Nominee Directors 页面**\n· 查看所有指定 ND 及其在任公司\n· 在任必须同时满足 Nominee Director subrole、已有就任日期、离任日期为空\n· 缺少 subrole 但有就任日期且无离任日期的记录会列为人工复核异常（LI JIANWEI、ZHANG DAN 除外）\n· 每天 05:00 SGT 从 TeamWork 同步\n\n[打开 Nominee Directors](/nominee-directors)';
  }
  if (pathname === '/late-filing') {
    return '**Late Filing 页面**\n· 列出符合迟报规则的公司及原因\n· 每天 08:00 SGT 自动检测\n· 若 Dashboard 显示超时或没有近期成功记录，应查看 Automation health 的详细异常，而不是只看页面数字\n\n[打开 Late Filing](/late-filing)';
  }
  if (pathname === '/billing') {
    return '**AR Reminder / Billing Drafts 页面**\n· AR Reminder：选择 FYE 周期、复核名单与状态\n· Billing Drafts：依据 TeamWork 服务状态和 QB 历史准备开单内容\n· 所有 Invoice 都先建立为 QuickBooks 草稿，仍需人工复核\n· PDF 可下载到本地文件夹；客户邮件在 Email Drafts 另行准备\n\n[AR Reminder](/billing?tab=ar) [Billing Drafts](/billing?tab=billing)';
  }
  if (pathname.startsWith('/master-list/active-clients')) {
    return '**Active Client 页面**\n· 查看 Active 客户主名单、UEN、FYE、PIC、服务标记与 TeamWork 对照\n· 公司行可点击打开完整详情\n· 服务格子是系统依据现有 TeamWork / 服务资料自动判断，灰色空格代表当前没有有效服务记录\n\n[打开 Active Client](/master-list/active-clients)';
  }
  if (pathname === '/') {
    return '**Dashboard 页面**\n· Automation health 显示各自动任务最近成功时间\n· Integration exceptions 可展开查看每个异常的来源和原因\n· 业务卡片可进入客户、ND、地址服务、AR 与 Late Filing 等工作页\n· 自动任务显示绿色不等于永久正常，仍应留意最近成功时间和开放异常';
  }
  return FAQ[6].a;
}

// ── Data tools (shared by both engines) ─────────────────────────────────────
async function searchCompany(q: string) {
  const sb = createAdminClient();
  const like = `%${q.trim()}%`;
  // A UEN-looking query searches registration_no instead of the name.
  const isUen = /^(19|20)\d{7,8}[A-Z]$/i.test(q.trim());
  const { data: comps } = await sb.from('companies')
    .select('company_name, registration_no, fye_month, tw_status, client_type, is_active, uses_address, has_nd, has_xbrl, pic, sec_pic, internal_id')
    .ilike(isUen ? 'registration_no' : 'company_name', isUen ? q.trim() : like).limit(5);
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

const AUTOMATION_SOURCES = [
  ['teamwork_nd_1', 'TeamWork ND (Batch 1)'],
  ['teamwork_nd_2', 'TeamWork ND (Batch 2)'],
  ['teamwork_nd_3', 'TeamWork ND (Batch 3)'],
  ['teamwork_nd_4', 'TeamWork ND (Batch 4)'],
  ['teamwork_nd_5', 'TeamWork ND (Batch 5)'],
  ['teamwork_companies', 'TeamWork Companies'],
  ['teamwork_secretary', 'TeamWork Secretary'],
  ['ar_generate', 'AR Generate'],
  ['quickbooks', 'QuickBooks'],
  ['ar_workflow', 'AR Workflow'],
  ['late_filing', 'Late Filing'],
] as const;

async function automationHealth() {
  const sb = createAdminClient();
  const [{ data: runs }, { count: openExceptions }] = await Promise.all([
    sb.from('automation_sync_runs')
      .select('source, status, started_at, finished_at, error')
      .in('source', AUTOMATION_SOURCES.map(([source]) => source))
      .order('started_at', { ascending: false })
      .limit(120),
    sb.from('automation_exceptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'open')
      .neq('exception_type', 'missing_nominee_subrole'),
  ]);
  const now = Date.now();
  return {
    checked_at: new Date(now).toISOString(),
    open_exceptions: openExceptions ?? 0,
    jobs: AUTOMATION_SOURCES.map(([source, label]) => {
      const sourceRuns = (runs ?? []).filter(run => run.source === source);
      const latest = sourceRuns[0] ?? null;
      const success = sourceRuns.find(run => run.status === 'success') ?? null;
      const successAt = success?.finished_at ?? success?.started_at ?? null;
      const ageHours = successAt
        ? Math.round(((now - new Date(successAt).getTime()) / 3_600_000) * 10) / 10
        : null;
      return {
        source,
        label,
        latest_status: latest?.status ?? 'never',
        success_age_hours: ageHours,
        needs_attention: ageHours == null || ageHours > 30 || latest?.status === 'failed',
        error: latest?.status === 'failed' ? latest.error : null,
      };
    }),
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
function systemPrompt(context?: AssistantContext) {
  return `You are the in-app assistant of the Tassure Corporate Services System (a Singapore corporate-services billing dashboard used by Tassure Asia staff). Answer in the user's language (usually Chinese). Be concise and concrete.

System map (link pages with markdown, e.g. [开单草稿](/billing?tab=billing)):
${PAGES.map(p => `- ${p.label}: ${p.href}`).join('\n')}

Current user location:
- Page: ${context?.page ?? 'unknown'}
- Path: ${context?.pathname ?? 'unknown'}
When the user says "this page", "this row", or asks a vague how-to question, prioritize the current location above.

Key workflows:
- AR pipeline: TeamWork determines each company's FYE cycle → ar_reminder batches auto-generate daily (rolling 6 months) → staff review → Billing Drafts. Deleting an AR row is a soft delete (won't be auto-recreated; Add Manual restores it).
- Billing Drafts: per company, pre-filled from the prior year's invoice (true annual fee incl. deferred-revenue split; discounts carried forward flagged for confirmation; ND presence trusted from TeamWork; XBRL must be confirmed each FY). "Generate Invoice in QuickBooks" creates a DRAFT in QB — never auto-sent.
- Client Communications: Email Drafts is a review-first workbench. Staff confirm template fields, recipient rules and invoice attachments; Outlook Helper creates Classic Outlook drafts; employees review and manually send. Prepared records are viewed in Email Activity.
- Companies inclusion is based on TeamWork Internal CSS Status = Active. CSS Client and Shareholder are additional TeamWork Client-column classifications.
- Recipient rules: external customer emails go to To; Tassure emails go to CC; cindy@tassure.com is excluded; hoechyi@tassure.com is always CC; when kahye@tassure.com appears, sengxin@tassure.com is omitted.
- Data freshness (SGT): TeamWork ND 05:00; TeamWork Companies and campaign recipients 05:30; AR generation 06:00; QuickBooks 06:30; AR workflow 07:00; Late Filing 08:00. Never claim a run succeeded without live evidence; direct staff to Dashboard Automation health when needed.

Use tools to answer data questions. Distinguish confirmed live data from general workflow guidance. If the user should go somewhere, include the markdown link. If you don't know or lack row-level context, say so plainly.`;
}

const CLAUDE_TOOLS = [
  { name: 'search_company', description: 'Look up companies by (partial) name: status, FYE month, services, PIC, active nominee directors, recent AR reminder rows.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'ar_batch', description: 'AR Reminder batch for a FYE month+year: totals and company names.', input_schema: { type: 'object', properties: { month: { type: 'string', description: 'English month name, e.g. April' }, year: { type: 'number' } }, required: ['month', 'year'] } },
  { name: 'nd_lookup', description: 'Look up a nominee director by person name: their active company appointments.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'automation_health', description: 'Read live automation job health and the open integration-exception count.', input_schema: { type: 'object', properties: {} } },
];

async function runTool(name: string, input: Record<string, unknown>) {
  if (name === 'search_company') return searchCompany(String(input.query ?? ''));
  if (name === 'ar_batch') return arBatch(String(input.month ?? ''), Number(input.year ?? 0));
  if (name === 'nd_lookup') return ndLookup(String(input.name ?? ''));
  if (name === 'automation_health') return automationHealth();
  return { error: 'unknown tool' };
}

async function claudeAnswer(messages: Msg[], context?: AssistantContext): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const convo: Record<string, unknown>[] = messages.map(m => ({ role: m.role, content: m.content }));
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: systemPrompt(context), tools: CLAUDE_TOOLS, messages: convo }),
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

type CompanyCardData = {
  name: string; uen: string | null; fye_month: string | null; status: string | null;
  client_type: string | null; active: boolean | null; pic: string | null;
  services: { address: boolean; nd: boolean; xbrl: boolean };
  nominee_directors: string[]; ar_reminders: string[];
};
function companyCard(c: CompanyCardData): string {
  const svcs = [c.services.address && '地址服务', c.services.nd && 'ND', c.services.xbrl && 'XBRL'].filter(Boolean).join(' + ') || '仅秘书';
  const lines = [
    `**${c.name}**`,
    `· UEN:${c.uen ?? '—'}`,
    `· 状态:${c.status ?? '—'}(${c.client_type ?? '—'})`,
    `· FYE 月份:${c.fye_month ?? '未记录'} · PIC:${c.pic ?? '—'}`,
    `· 服务:${svcs}`,
  ];
  if (c.nominee_directors.length) lines.push(`· 在任 ND:${c.nominee_directors.join('、')}`);
  for (const r of c.ar_reminders) lines.push(`· AR:${r}`);
  return lines.join('\n');
}

async function intentAnswer(text: string, context?: AssistantContext): Promise<string> {
  const t = text.toLowerCase().trim();

  // Current-page help: the widget sends its location so vague questions do
  // not fall through to a generic answer.
  if (/(这个页面|这页|当前页面|这里).*(怎么用|做什么|有什么|如何|说明|帮助)|(怎么用|如何使用).*(这个页面|这页|这里)/.test(t)) {
    return currentPageHelp(context?.pathname);
  }

  if (/(自动化|automation|cron|定时任务|同步任务|项目需要处理|今天.*处理|任务.*正常)/.test(t)) {
    const health = await automationHealth();
    const attention = health.jobs.filter(job => job.needs_attention);
    return [
      '**当前自动化健康状态**',
      `· 开放 Integration exceptions：**${health.open_exceptions}**`,
      ...health.jobs.map(job => `· ${job.label}：${job.needs_attention ? '需要注意' : '正常'} · 最近成功 ${job.success_age_hours == null ? '无记录' : `${job.success_age_hours} 小时前`}${job.latest_status === 'failed' ? ' · 最新运行失败' : ''}`),
      '',
      attention.length
        ? `需要优先查看：${attention.map(job => job.label).join('、')}`
        : '六项每日任务目前都在 30 小时成功窗口内。',
      '',
      '[打开 Dashboard 查看异常详情](/)',
    ].join('\n');
  }

  // 1. AR batch by month — checked BEFORE FAQ so "4月有几家没开单" isn't
  //    hijacked by the 已开单/没开单 FAQ entry.
  const monthKey = Object.keys(MONTH_MAP).sort((a, b) => b.length - a.length).find(k => t.includes(k));
  if (monthKey && /(ar|年报|开单|开票|reminder|billing|batch|批次|几家|多少|名单|清单)/.test(t)) {
    const yearMatch = t.match(/20\d{2}/);
    const year = yearMatch ? +yearMatch[0] : new Date().getFullYear();
    const b = await arBatch(MONTH_MAP[monthKey], year);
    if (!b.total) return `${MONTH_MAP[monthKey]} ${year} 还没有 AR Reminder 批次。\n\n[AR Reminder](/billing?tab=ar) 可切换月份查看或生成。`;
    return [
      `**${MONTH_MAP[monthKey]} ${year} AR 批次**`,
      `· 共 **${b.total}** 家`,
      `· 待处理 ${b.pending} · 已申报 ${b.filed}`,
      '',
      '部分名单:',
      ...b.companies.slice(0, 8).map(n => `· ${n}`),
      b.total > 8 ? `…共 ${b.total} 家,完整名单见页面` : '',
      '',
      `[AR Reminder 查看批次](/billing?tab=ar) [Billing Drafts 去开单](/billing?tab=billing)`,
    ].filter(l => l !== '').join('\n').replace('部分名单:\n', '部分名单:\n');
  }

  // 2. FAQ (longest-phrase keyword sets)
  for (const f of FAQ) if (f.kw.some(k => t.includes(k))) return f.a;

  // 3. Due-soon: "最近有什么到期 / 30天内到期"
  if (/(到期|due|快到了|截止)/.test(t)) {
    const days = +(t.match(/(\d+)\s*天/)?.[1] ?? 45);
    const sb = createAdminClient();
    const today = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    const { data } = await sb.from('ar_reminder')
      .select('entity_name, due_date, fye_month, fye_year')
      .gte('due_date', today).lte('due_date', until)
      .or('status.is.null,status.neq.Excluded')
      .order('due_date', { ascending: true }).limit(200);
    const rows = data ?? [];
    if (!rows.length) return `未来 ${days} 天内没有到期的 AR。\n\n[AR Reminder](/billing?tab=ar)`;
    return [
      `**未来 ${days} 天内到期的 AR:共 ${rows.length} 家**`,
      '',
      ...rows.slice(0, 10).map(r => `· ${r.due_date} — ${r.entity_name}(FYE ${r.fye_month} ${r.fye_year})`),
      rows.length > 10 ? `…共 ${rows.length} 家` : '',
      '',
      `[AR Reminder 查看全部](/billing?tab=ar)`,
    ].filter(Boolean).join('\n');
  }

  // 4. Late-filing count: "有几家迟报"
  if (/(迟报|late filing|逾期)/.test(t) && /(几家|多少|count|名单|哪些)/.test(t)) {
    const sb = createAdminClient();
    const { data } = await sb.from('late_filing_companies').select('company_name').limit(200);
    const rows = data ?? [];
    return [
      `**迟报监控名单:共 ${rows.length} 家**`,
      '',
      ...rows.slice(0, 10).map(r => `· ${r.company_name}`),
      rows.length > 10 ? `…共 ${rows.length} 家` : '',
      '',
      `[Late Filing 查看全部](/late-filing)`,
    ].filter(Boolean).join('\n');
  }

  // 5. Navigation with a verb: 去/打开/带我/open/go
  if (/(去|打开|带我|跳转|open |go to |进入|看看)/.test(t)) {
    for (const p of PAGES) if (p.kw.some(k => t.includes(k))) return `好的,带你去 **${p.label}**\n\n[点击打开](${p.href})`;
  }

  // 6. ND person lookup: "XX 有哪些公司 / 挂了几家"
  if (/(哪些公司|几家公司|挂名|任职|appointments|在任)/.test(t)) {
    const nameGuess = text.replace(/有哪些公司|挂名|挂了几家公司?|任职|在任|的|哪些|几家|公司|appointments|\?|？/g, '').trim();
    if (nameGuess.length >= 2) {
      const r = await ndLookup(nameGuess);
      if (r.found) {
        return r.directors.map(d => [
          `**${d.name}** 当前在任 **${d.active_count}** 家`,
          '',
          ...d.companies.slice(0, 12).map(c => `· ${c}`),
          d.active_count > 12 ? `…共 ${d.active_count} 家` : '',
        ].filter(Boolean).join('\n')).join('\n\n')
          + `\n\n[Nominee Directors 详情](/nominee-directors)`;
      }
    }
  }

  // 7. Company lookup — accepts company names or a UEN (e.g. 202320434R)
  const uen = text.match(/(19|20)\d{7,8}[A-Z]/i)?.[0];
  const cleaned = uen ?? text.replace(/查|一下|帮我|公司|的资料|的信息|的情况|情况|status|是什么|的?nd是谁|的?pic是?谁?|谁是|开过什么单|\?|？/g, ' ').trim();
  if (cleaned.length >= 3) {
    const r = await searchCompany(cleaned);
    if (r.found) {
      return r.companies.map(companyCard).join('\n\n')
        + `\n\n[Companies 公司库](/companies) [Billing Drafts 开单](/billing?tab=billing)`;
    }
  }

  // 8. Bare page name without a verb ("late filing", "开单草稿")
  for (const p of PAGES) if (p.kw.some(k => k.length >= 2 && t.includes(k))) {
    return `你要找的应该是 **${p.label}**\n\n[点击打开](${p.href})`;
  }

  // 9. Fallback: capabilities
  return [
    '我可以帮你:',
    '· **查公司** — 输入公司名或 UEN,如 "INFINITY LINKS"',
    '· **查 ND** — 如 "CHEN DE 有哪些公司"',
    '· **查 AR 批次** — 如 "4月2026有几家AR"',
    '· **查到期** — 如 "30天内有什么到期"',
    '· **查迟报** — 如 "有几家迟报"',
    '· **Email Drafts** — 如 "为什么这行还不能 Ready"',
    '· **Outlook Helper** — 如 "Helper 怎么安装和检查"',
    '· **页面导航** — 如 "打开开单草稿"',
    '· **流程问题** — 如 "怎么开单"、"To 和 CC 的规则是什么"、"Prepared 后去哪里看"',
    '',
    `快捷入口:${PAGES.slice(0, 5).map(p => `[${p.label}](${p.href})`).join(' ')} [Email Drafts](/client-communications/campaigns)`,
  ].join('\n');
}

// ── Route ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { messages, context } = (await req.json().catch(() => ({}))) as {
    messages?: Msg[];
    context?: AssistantContext;
  };
  if (!messages?.length) return NextResponse.json({ error: 'messages required' }, { status: 400 });

  const last = messages[messages.length - 1];
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const reply = await claudeAnswer(messages.slice(-8), context);
      return NextResponse.json({ reply, engine: 'claude' });
    }
    const reply = await intentAnswer(last.content, context);
    return NextResponse.json({ reply, engine: 'intent' });
  } catch (e) {
    // Claude path failed (bad key / network) — degrade to the intent engine.
    try {
      const reply = await intentAnswer(last.content, context);
      return NextResponse.json({ reply, engine: 'intent-fallback', note: e instanceof Error ? e.message : 'claude failed' });
    } catch {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'assistant failed' }, { status: 500 });
    }
  }
}
