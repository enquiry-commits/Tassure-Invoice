import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { normalize } from '@/lib/company-name';
import { getRequestAccount } from '@/lib/request-account';
import { computeMyTasks } from '@/lib/my-tasks-data';
import { buildTaskDigest, generateMyTasksBrief } from '@/lib/my-tasks-brief';
import { getPersonActivitySummary } from '@/lib/activity-data';
import { getRecentActivity, summarizeByKind } from '@/lib/recent-activity';
import { createMemory, listMemories, type MemoryType } from '@/lib/user-memories';
import { getConversationOwner, appendMessage, deriveTitle, renameConversation, touchConversation } from '@/lib/ai-conversations';
import { findMentionedAccount, resolveViewAsAccount, isWithinRestriction, type ApprovedAccount } from '@/lib/approved-accounts';
import { previewInvoiceDraft, type InvoicePreview } from '@/lib/billing-lookup';
import { previewLateFilingResolve, type LateFilingResolvePreview } from '@/lib/late-filing-lookup';
import { previewInvoiceEdit, type InvoiceEditPreview, type InvoiceEditChange } from '@/lib/invoice-edit-lookup';
import type { QbCompany } from '@/lib/quickbooks';
import { billingDeepLink, lateFilingDeepLink } from '@/lib/deep-links';
import {
  validatePostIncorporateInput,
  type PostIncorporateInput, type PostIncorporateCompany, type PostIncorporateDirector, type PostIncorporateShareholder, type PostIncorporatePreview,
} from '@/lib/docx-post-incorporate';

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
  if (pathname === '/my-tasks') {
    return '**My Tasks 页面**\n· 汇总你自己名下（SEC/ACC/TAX PIC）的 AR Reminder 逾期、即将到期与 Late Filing 项目\n· 页面上方的"Today\'s Priority"是根据你目前真实的任务自动生成的每日提醒\n· 直接问我"我今天要优先处理什么"也可以，会按你自己的账号回答\n\n[打开 My Tasks](/my-tasks)';
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

// Vincent, 2026-09-08: "更智能的分析和判断用户要做什么...可以沟通，可以对
// 话" — this is the assistant's own personal-task tool, reusing the EXACT
// same computeMyTasks() the on-screen My Tasks page and its own daily
// briefing banner already use (lib/my-tasks-data.ts / lib/my-tasks-brief.ts)
// — so "what should I do today" answered in chat can never disagree with
// what My Tasks itself shows. `account` is the REAL logged-in caller
// (from getRequestAccount(req) in POST below) — this assistant route was
// otherwise fully anonymous before this, so a caller with no valid
// session gets an explicit "can't identify you" rather than someone
// else's data or a silent guess.
// Extended 2026-09-08, same day, after Vincent screenshotted "如果我是HC，
// 我要做什么今天？" falling through to the generic fallback: "我是最大的
// ADMIN，和管理层就可以问这些问题，其他人一般只能问自己相关的东西" — an
// optional `personQuery` (a name/nickname/initials, e.g. "HC") lets a
// management account ask about a DIFFERENT staff member's tasks, reusing
// the exact same target universe and same canViewAsOthers gate the My
// Tasks page's own "View As" picker already enforces
// (app/api/my-tasks/route.ts) — this is not a new permission, it's the
// same one asked through chat instead of a dropdown. Enforced HERE, not
// left to the calling engine to remember to check, since this function is
// the one place both engines (Claude tool-use and the intent router) both
// call through runTool()/directly.
async function myTasksSummary(account: ApprovedAccount | null, personQuery?: string) {
  if (!account) return { signed_in: false as const, message: 'No valid session on this request — ask the user to make sure they are logged in, then try again.' };

  let target = account;
  if (personQuery && personQuery.trim()) {
    const mentioned = findMentionedAccount(personQuery);
    if (!mentioned) {
      return { signed_in: true as const, staff_name: account.name, person_not_found: true as const, message: `Could not match "${personQuery}" to a known staff account — tell the user plainly you don't recognize that name rather than guessing whose tasks to show.` };
    }
    if (mentioned.email !== account.email) {
      if (!account.canViewAsOthers) {
        return { signed_in: true as const, staff_name: account.name, permission_denied: true as const, message: `${account.name} does not have permission to view another staff member's tasks — that is limited to management accounts. Tell the user plainly they can only ask about their own tasks, do not reveal ${mentioned.name}'s data.` };
      }
      target = mentioned;
    }
  }

  const tasks = await computeMyTasks(target);
  return { signed_in: true as const, staff_name: target.name, viewing_other: target.email !== account.email, ...buildTaskDigest(tasks) };
}

// Vincent, 2026-09-08, the same day, pushing further than AR/Late Filing:
// "为什么这个用户每天会打开这个页面，为什么会时常在这个页面操作，为什么
// 每次关注某些特定的更新" — real observed page-visit/action history
// (lib/activity-data.ts, user_activity_events), available to anyone about
// THEMSELVES (no canViewActivityInsights gate — that flag is for seeing
// OTHER people's data; this is "tell me about my own habits", same
// self-only reasoning as my_tasks_summary above). This table only
// accumulates from 2026-09-08 onward — a brand-new account or a quiet
// week genuinely has little or nothing to report, and this tool says so
// honestly rather than the model inventing a plausible-sounding pattern.
async function myActivityPattern(account: ApprovedAccount | null) {
  if (!account) return { signed_in: false as const, message: 'No valid session on this request — ask the user to make sure they are logged in, then try again.' };
  const summary = await getPersonActivitySummary(account.email, 30);
  if (summary.totalEvents === 0) {
    return { signed_in: true as const, staff_name: account.name, no_data: true as const, message: 'No activity has been recorded for this person yet — tracking only started 2026-09-08 and has no historical data. Say so plainly rather than guessing a pattern.' };
  }
  return {
    signed_in: true as const, staff_name: account.name, range_days: summary.rangeDays, total_events: summary.totalEvents,
    top_pages: summary.topPages.map(p => ({ page: p.pathname, visits: p.visits, last_visited: p.lastVisitedAt })),
    top_actions: summary.topActions.map(a => ({ action: a.eventType, count: a.count, last_at: a.lastAt })),
    hour_of_day_distribution: summary.hourOfDayDistribution,
  };
}

// Vincent, 2026-09-08, on the "View as: Chelsea Ang" screen showing 0
// tasks despite her using the system daily: "没有真正了解到...我们的员工
// 在做什么". Real audit-trail activity (lib/recent-activity.ts) — invoices
// generated, AR edits, campaigns, Master List changes, sent emails, etc —
// NOT the same as my_activity_pattern above (that's page-VISIT tracking,
// only from 2026-09-08 onward; this reaches back through each feature's
// own existing "who did this" columns, real history predating today).
// Supports the same optional cross-person `person` lookup as
// my_tasks_summary, for the same reason and the same permission.
async function recentActivitySummary(account: ApprovedAccount | null, personQuery?: string) {
  if (!account) return { signed_in: false as const, message: 'No valid session on this request — ask the user to make sure they are logged in, then try again.' };

  let target = account;
  if (personQuery && personQuery.trim()) {
    const mentioned = findMentionedAccount(personQuery);
    if (!mentioned) {
      return { signed_in: true as const, staff_name: account.name, person_not_found: true as const, message: `Could not match "${personQuery}" to a known staff account — tell the user plainly you don't recognize that name rather than guessing whose activity to show.` };
    }
    if (mentioned.email !== account.email) {
      if (!account.canViewAsOthers) {
        return { signed_in: true as const, staff_name: account.name, permission_denied: true as const, message: `${account.name} does not have permission to view another staff member's activity — that is limited to management accounts. Tell the user plainly they can only ask about their own activity, do not reveal ${mentioned.name}'s data.` };
      }
      target = mentioned;
    }
  }

  const items = await getRecentActivity(target.email, 25);
  if (!items.length) {
    return { signed_in: true as const, staff_name: target.name, viewing_other: target.email !== account.email, no_data: true as const, message: 'No recorded activity for this person in generated_invoices/ar_reminder/email_campaigns/master_list/email_drafts/post_incorporate_operations/trademark_records/soa_owners. This is a genuine possibility for someone whose real work is outside these specific features (e.g. TeamWork-only work), not necessarily a tracking gap — say so plainly rather than assuming something is broken.' };
  }
  return {
    signed_in: true as const, staff_name: target.name, viewing_other: target.email !== account.email,
    total_items: items.length,
    by_kind: summarizeByKind(items),
    most_recent: items.slice(0, 8),
  };
}

// Step 1 of Vincent's agentic-invoicing direction ("假设我真的要你执行，
// 你能不能做到一步一步的引导，当遇到敏感的情况，就跳出弹窗要用户确认继
// 续", 2026-09-08) — READ-ONLY preview of what a Billing Drafts invoice
// would look like for one company, using the EXACT SAME pre-fill logic the
// real page uses (lib/billing-lookup.ts, extracted verbatim from
// app/api/billing/renewals/route.ts + app/billing/page.tsx — see those
// files' own comments). This tool can never create anything in QuickBooks
// — there is no write path here at all, deliberately, until a later,
// separate step builds the actual confirm-and-execute flow with a real UI
// confirmation gate.
//
// Gated identically to the Billing Drafts PAGE itself: the 6 AR-Reminder-
// restricted accounts (`restrictedTo: '/billing?tab=ar'`) cannot open
// Billing Drafts directly (enforced in proxy.ts) — a chat tool must never
// become a silent bypass of that same restriction, so this checks the
// identical isWithinRestriction() rule before returning any billing-draft
// data, not just relying on the page-level block.
async function invoiceDraftPreview(account: ApprovedAccount | null, companyQuery: string, fyeYear?: number) {
  if (!account) return { error: true as const, message: 'No valid session on this request — ask the user to make sure they are logged in, then try again.' };
  if (account.restrictedTo && !isWithinRestriction(account.restrictedTo, '/billing', new URLSearchParams({ tab: 'billing' }))) {
    return { error: true as const, message: `${account.name}'s account does not have access to Billing Drafts, so it cannot preview invoice drafts either. Tell the user plainly this isn't available to their account — do not show any billing data.` };
  }
  const result = await previewInvoiceDraft(companyQuery, fyeYear);
  if (!result.found) {
    // Each suggestion becomes a real, working link straight to that
    // company's Billing Drafts entry (not just a name for the user to go
    // type in themselves) — see lib/deep-links.ts's own header comment.
    // No fyeMonth/fyeCycle known for a bare suggestion string, so the link
    // omits them; the target page falls back to whatever cycle it already
    // has loaded.
    const suggestionLinks = result.suggestions.map(name => ({ name, link: billingDeepLink(name, null, '') }));
    return {
      found: false as const,
      message: `No company matched "${companyQuery}".`,
      suggestions: suggestionLinks,
      instruction: suggestionLinks.length
        ? 'Present each suggestion as a clickable markdown link using its "link" value, e.g. [Company Name](link) — do not just list the bare names.'
        : undefined,
    };
  }
  return {
    found: true as const,
    // Full InvoicePreview passed through as-is (not re-mapped to a
    // stripped-down subset) — Claude only reasons over company/fyeCycle/
    // lines/totals/warnings, but the frontend's real "Confirm & Generate"
    // card (2026-09-08 — Vincent: "不能直接和用户确认后弹出真正的弹窗
    // 吗") needs companyId/email/pic and each line's productService too,
    // to submit the EXACT same payload app/billing/page.tsx itself sends
    // to /api/quickbooks/create-invoice. See claudeAnswer()'s own capture
    // of this same object as `invoicePreview` on the reply.
    preview: result.preview,
    note: 'READ-ONLY preview using the exact same pre-fill rules as Billing Drafts — nothing has been created in QuickBooks, and you have no tool that can create one directly. Present it clearly (company, FYE cycle, each INCLUDED line with its amount, the total, any warnings, and whether it is already invoiced this cycle). The user will see a real "Generate Invoice" button on this preview in the UI — tell them to review it and click that themselves when ready; never claim you generated, will generate, or are generating the real invoice yourself.',
  };
}

// Phase 2 of the agentic-chat direction ("可以把上面的4项分阶段进行吗？我
// 觉得都需要", 2026-09-09) — READ-ONLY preview of what marking a Late
// Filing record "Resolved" would set its remarks to, using the exact same
// getLateFilingList() the real page's own list is built from and the exact
// same resolve() remarks rule (lib/late-filing-lookup.ts). No auth
// restriction check needed here the way preview_invoice_draft has one —
// /late-filing carries no page-level restriction the 6 AR-Reminder-only
// accounts don't already structurally lose access to (they can't reach
// /my-tasks chat at all, per that tool's own comment).
async function lateFilingResolvePreview(account: ApprovedAccount | null, companyQuery: string) {
  if (!account) return { error: true as const, message: 'No valid session on this request — ask the user to make sure they are logged in, then try again.' };
  const result = await previewLateFilingResolve(companyQuery);
  if (!result.found) {
    const suggestionLinks = result.suggestions.map(name => ({ name, link: lateFilingDeepLink(name) }));
    return {
      found: false as const,
      message: `No company matched "${companyQuery}" in the Late Filing list.`,
      suggestions: suggestionLinks,
      instruction: suggestionLinks.length
        ? 'Present each suggestion as a clickable markdown link using its "link" value, e.g. [Company Name](link) — do not just list the bare names.'
        : undefined,
    };
  }
  return {
    found: true as const,
    preview: result.preview,
    note: 'READ-ONLY preview of what marking this Late Filing record "Resolved" would set its remarks to — nothing has been changed yet, and you have no tool that can change it directly. Present it clearly (company, UEN, overdue FYE year, current remarks, and what the remarks would become), then tell the user a real "Mark Resolved" button with its own confirmation appears in the UI on this preview — never claim you resolved it yourself. If it is already resolved, say so plainly.',
  };
}

// Phase 3 of the agentic-chat direction ("可以把上面的4项分阶段进行吗？我
// 觉得都需要", 2026-09-09) — the hardest of the four, because unlike a new
// draft there is no algorithmic way to compute "what the edit should be";
// the user has to STATE it, and this tool's `changes` argument is where
// Claude's own understanding of that statement gets turned into
// structured data BEFORE any real lookup happens — lib/invoice-edit-
// lookup.ts then does the actual matching/diffing against the real
// current invoice, never trusting Claude's own arithmetic. Gated by the
// same isWithinRestriction() check as preview_invoice_draft — this reads
// and would eventually let a user touch the same Billing Drafts data.
async function invoiceEditPreview(account: ApprovedAccount | null, companyQuery: string, qbCompanyHint: QbCompany | undefined, changes: InvoiceEditChange[]) {
  if (!account) return { error: true as const, message: 'No valid session on this request — ask the user to make sure they are logged in, then try again.' };
  if (account.restrictedTo && !isWithinRestriction(account.restrictedTo, '/billing', new URLSearchParams({ tab: 'billing' }))) {
    return { error: true as const, message: `${account.name}'s account does not have access to Billing Drafts, so it cannot preview or edit invoices either. Tell the user plainly this isn't available to their account — do not show any billing data.` };
  }
  if (!changes.length) {
    return { error: true as const, message: 'No change was specified. Ask the user exactly which line and what the new value should be before calling this tool.' };
  }
  const result = await previewInvoiceEdit(companyQuery, qbCompanyHint, changes);
  if (!result.found) {
    const suggestionLinks = (result.suggestions ?? []).map(name => ({ name, link: billingDeepLink(name, null, '') }));
    return {
      found: false as const,
      message: result.message,
      suggestions: suggestionLinks,
      instruction: suggestionLinks.length
        ? 'Present each suggestion as a clickable markdown link using its "link" value, e.g. [Company Name](link) — do not just list the bare names.'
        : undefined,
    };
  }
  return {
    found: true as const,
    preview: result.preview,
    note: 'READ-ONLY preview of an edit to a REAL, already-generated invoice — nothing has been changed in QuickBooks yet, and you have no tool that can change it directly. Present the diff clearly (each changed line: before → after, and the total: before → after). If unmatchedChanges is non-empty, tell the user plainly which requested change could not be matched to a real line rather than silently ignoring it. The UI shows a real "Save Changes" button on this preview with its own confirmation — never claim you saved or are saving the change yourself.',
  };
}

// Phase 4 of the agentic-chat direction — and a real course-correction.
// Vincent, on the first read of this feature's real data requirements
// (director/shareholder ID numbers, addresses, nominee sub-fields — real
// legal-document identity data with no automatic source): "我比较极端 我
// 希望是可以真正协助执行操作的，不只是停留在询问和回答阶段...你要思考用
// 户真正要的是什么，你又可以帮助什么" — rejecting a downgrade to a
// read-only status query. The resolution: this tool doesn't INFER any
// identity data (that would be genuinely dangerous — a wrong NRIC or
// address on a real legal document) — it validates whatever the
// conversation has GUIDED the user into providing, using the exact real
// validatePostIncorporateInput() the live page itself uses. Claude's job
// (see the static prompt) is to be the guided intake form: ask for a
// director/shareholder's real details a few at a time, track what's been
// given across the conversation, never invent a value, and only call this
// once it believes the picture is complete — the tool is the source of
// truth on whether it actually is.
// Claude assembles this tool's `input` incrementally across a multi-turn
// conversation (the guided intake), so it arrives as loosely-typed JSON —
// never trust it has every field the real PostIncorporateInput type
// declares. This mirrors that type's fields exactly (mechanically, field
// for field, against the real definitions in lib/docx-post-incorporate.ts
// — not re-derived from memory) and fills anything missing/mistyped with
// a safe empty default, so validatePostIncorporateInput() below never
// throws on a `.trim()` of undefined — it just reports the field as
// missing, which is the correct behavior here anyway.
function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function bool(v: unknown): boolean { return v === true; }
function strArr(v: unknown): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; }
function nominatorType(v: unknown): 'individual' | 'corporate entity' | '' {
  return v === 'individual' || v === 'corporate entity' ? v : '';
}
// Same constant/default the real /post-incorporate page's own emptyCompany()
// pre-fills (app/post-incorporate/page.tsx) — Tassure's own registered
// secretarial-firm name never varies per company, so the guided intake
// shouldn't waste a turn asking for it unless the user overrides it.
const TASSURE_SECRETARY_COMPANY_NAME = 'TASSURE ASIA BIZSERVICES PTE LTD';
function normalizePostIncorporateInput(raw: Record<string, unknown>): PostIncorporateInput {
  const rc = (raw.company && typeof raw.company === 'object') ? raw.company as Record<string, unknown> : {};
  const company: PostIncorporateCompany = {
    name: str(rc.name), uen: str(rc.uen), address: str(rc.address), regDate: str(rc.regDate),
    chairmanName: str(rc.chairmanName), secretaryName: str(rc.secretaryName),
    secretaryCompanyName: str(rc.secretaryCompanyName) || TASSURE_SECRETARY_COMPANY_NAME,
    secretaryCompanyAddress: str(rc.secretaryCompanyAddress),
    currency: str(rc.currency) || 'SGD', financialYearEndDayMonth: str(rc.financialYearEndDayMonth),
    needNdService: bool(rc.needNdService),
  };

  const nominatorFields = (r: Record<string, unknown>) => ({
    nominatorType: nominatorType(r.nominatorType),
    nominatorIndName: str(r.nominatorIndName), nominatorIndAddress: str(r.nominatorIndAddress),
    nominatorIndNationality: str(r.nominatorIndNationality), nominatorIndIdentificationNumber: str(r.nominatorIndIdentificationNumber),
    nominatorIndBirthDate: str(r.nominatorIndBirthDate), nominatorIndEmail: str(r.nominatorIndEmail),
    nominatorIndContactNumber: str(r.nominatorIndContactNumber), nominatorIndDateBecameNominator: str(r.nominatorIndDateBecameNominator),
    nominatorCorpName: str(r.nominatorCorpName), nominatorCorpUen: str(r.nominatorCorpUen),
    nominatorCorpRegisteredAddress: str(r.nominatorCorpRegisteredAddress), nominatorCorpLegalForm: str(r.nominatorCorpLegalForm),
    nominatorCorpRepresentative: str(r.nominatorCorpRepresentative), nominatorCorpEmail: str(r.nominatorCorpEmail),
    nominatorCorpContactNumber: str(r.nominatorCorpContactNumber), nominatorCorpDateBecameNominator: str(r.nominatorCorpDateBecameNominator),
  });

  const directors: PostIncorporateDirector[] = (Array.isArray(raw.directors) ? raw.directors : []).map(rd => {
    const d = (rd && typeof rd === 'object') ? rd as Record<string, unknown> : {};
    return {
      name: str(d.name), address: str(d.address), identificationType: str(d.identificationType),
      identificationNumber: str(d.identificationNumber), nationality: str(d.nationality),
      dateOfBirth: str(d.dateOfBirth), gender: str(d.gender), email: str(d.email), phone: str(d.phone),
      isNomineeDirector: bool(d.isNomineeDirector),
      ...nominatorFields(d),
    };
  });

  const shareholders: PostIncorporateShareholder[] = (Array.isArray(raw.shareholders) ? raw.shareholders : []).map(rs => {
    const s = (rs && typeof rs === 'object') ? rs as Record<string, unknown> : {};
    return {
      name: str(s.name), address: str(s.address), identificationType: str(s.identificationType),
      identificationNumber: str(s.identificationNumber), numberOfShares: str(s.numberOfShares),
      paidUpCapital: str(s.paidUpCapital), fullyPaidUp: bool(s.fullyPaidUp),
      shareCertificateNo: str(s.shareCertificateNo), corporateDirectorNames: strArr(s.corporateDirectorNames),
      corpRepresentative: str(s.corpRepresentative), corpRepIdType: str(s.corpRepIdType), corpRepIdNo: str(s.corpRepIdNo),
      isNomineeShareholder: bool(s.isNomineeShareholder),
      ...nominatorFields(s),
    };
  });

  return { company, directors, shareholders };
}

async function postIncorporatePreview(account: ApprovedAccount | null, raw: Record<string, unknown>) {
  if (!account) return { error: true as const, message: 'No valid session on this request — ask the user to make sure they are logged in, then try again.' };
  const input = normalizePostIncorporateInput(raw);
  const errors = validatePostIncorporateInput(input);
  if (errors.length) {
    return {
      complete: false as const,
      errors,
      message: `Not ready yet — ${errors.join(' ')} Ask the user for exactly what's missing (do not guess or invent any value yourself — especially identification numbers, addresses, dates of birth, and share details, which must come from the user exactly as given, never inferred).`,
    };
  }
  const preview: PostIncorporatePreview = {
    input,
    company: input.company.name,
    uen: input.company.uen,
    directorsCount: input.directors.filter(d => d.name.trim()).length,
    shareholdersCount: input.shareholders.filter(s => s.name.trim()).length,
    needNdService: input.company.needNdService,
  };
  return {
    complete: true as const,
    preview,
    note: 'All required fields are present and pass validation. Present a clear summary to the user (company, UEN, N directors, N shareholders, whether ND service is needed) and confirm it looks right before they proceed — the UI shows a real "Generate & Download" button on this preview. You have no tool that creates the actual documents yourself; never claim you generated or downloaded them.',
  };
}

// Vincent's shared blueprint, section 5: structured long-term memory
// ("Fact/Preference/Behaviour/..."), with an explicit warning right next
// to it that v1 deliberately honors — "AI 不应因为一次对话就永久定义用户"
// (the AI shouldn't permanently define the user from one conversation).
// So this tool ONLY fires when the user directly, explicitly asks the
// assistant to remember/note something — never silently inferred from
// conversation tone or from user_activity_events. See the system prompt's
// own instruction on when to actually call this.
const VALID_MEMORY_TYPES: MemoryType[] = ['fact', 'preference', 'behaviour', 'relationship', 'project', 'decision', 'rejection', 'pattern'];
async function rememberThis(account: ApprovedAccount | null, memoryType: string, content: string) {
  if (!account) return { saved: false as const, message: 'No valid session on this request — cannot save a memory for an unidentified user.' };
  const type = (VALID_MEMORY_TYPES as string[]).includes(memoryType) ? (memoryType as MemoryType) : 'fact';
  if (!content.trim()) return { saved: false as const, message: 'Nothing to remember — content was empty.' };
  const memory = await createMemory(account.email, type, content.trim().slice(0, 500));
  return { saved: true as const, memory_id: memory.id, memory_type: memory.memory_type, content: memory.content };
}

// ── Engine A: Claude with tool use ───────────────────────────────────────────
// Split into a STATIC block (identical for every user/request — persona,
// system map, key workflows, tool-usage instructions) and a DYNAMIC block
// (current user identity/location/memories — genuinely different every
// call). Added 2026-09-08, prompted by Vincent sharing his own research
// doc on prompt caching ("系统提示词变化小，用 cache_control 做提示词缓
// 存"): claudeAnswer() below marks only the static block cacheable — with
// the two interleaved in one string (the original shape here), a cache
// breakpoint after the whole thing would barely ever hit, since the
// per-user middle section changes on nearly every call and breaks the
// prefix match. Splitting them like this means the (much larger) static
// block — plus CLAUDE_TOOLS, which the Anthropic API caches as part of
// the same prefix ahead of system — can actually be reused across
// different users and turns, not just repeated calls from the exact same
// person with the exact same memories.
function staticSystemPrompt(): string {
  return `You are the in-app assistant of the Tassure Corporate Services System (a Singapore corporate-services billing dashboard used by Tassure Asia staff). Answer in the user's language (usually Chinese). Be concise and concrete.

Never translate a person's name or a company's name into Chinese characters, even when the rest of your reply is in Chinese — e.g. "Shi Ming" stays "Shi Ming", never guessed into "石明". These are stored and used system-wide exactly as romanized/English text (see the staff and company data itself); inventing a Chinese rendering is a fabrication the system has no real source for, not a translation. Keep names exactly as they appear in the data you're given.

System map (link pages with markdown, e.g. [开单草稿](/billing?tab=billing)):
${PAGES.map(p => `- ${p.label}: ${p.href}`).join('\n')}

When the user says "this page", "this row", or asks a vague how-to question, prioritize the current location given in the next message.

Use the my_tasks_summary tool for any question about "my tasks", "what should I do today", overdue items assigned to the user, or similar — it already knows who is asking. If it returns counts.total 0, check everAssigned before answering: everAssigned false means this account has NEVER been PIC on anything (typical for management/owner accounts who aren't caseworkers) — say that plainly, don't say "you're all caught up" (which wrongly implies work existed and got done). everAssigned true with total 0 means genuinely caught up. If the user asks about a DIFFERENT staff member's tasks instead of their own (e.g. "如果我是HC，我要做什么今天？", "Show me Cindy's tasks", "HC 今天有什么任务") pass that person's name/nickname/initials as the tool's optional "person" argument — the tool itself enforces whether this account is allowed to see someone else's tasks (a management-only permission) and returns an explicit refusal or "not found" message when it can't proceed; relay that message honestly and do not fall back to answering about the caller instead, and never invent or guess another person's task data yourself. Use my_activity_pattern for questions about the user's OWN usage habits ("why do I keep opening X", "what do I do most often", "when am I most active") — it reflects real recorded page-visit/action history only from 2026-09-08 onward; if it reports no_data, say plainly that there isn't enough history yet rather than inventing a plausible-sounding pattern. Use recent_activity_summary for "what has X actually been doing" / "what's Chelsea been up to" style questions, INCLUDING open-ended ones like "根据她最近做的东西，判断她接下来会做什么" (based on her recent activity, predict what she'll likely do next) — call the tool to get the real data, then reason over it yourself; don't just recite the raw counts back. It reads real audit-trail history (invoices, AR edits, campaigns, Master List, sent emails, ...) that predates today, unlike my_activity_pattern's page-view tracking; it also accepts an optional "person" argument with the same management-only permission as my_tasks_summary. Never guess whose tasks or habits are whose from name alone.

Use the remember_this tool ONLY when the user EXPLICITLY asks you to remember, note, or keep in mind something for the future (e.g. "记住...", "以后都...", "remember that I..."). Never call it just because something seems noteworthy from the conversation's tone — a single passing remark is not a durable preference, and this tool writes something that will keep influencing future conversations.

Key workflows:
- AR pipeline: TeamWork determines each company's FYE cycle → ar_reminder batches auto-generate daily (rolling 6 months) → staff review → Billing Drafts. Deleting an AR row is a soft delete (won't be auto-recreated; Add Manual restores it).
- Billing Drafts: per company, pre-filled from the prior year's invoice (true annual fee incl. deferred-revenue split; discounts carried forward flagged for confirmation; ND presence trusted from TeamWork; XBRL must be confirmed each FY). "Generate Invoice in QuickBooks" creates a DRAFT in QB — never auto-sent.
- Client Communications: Email Drafts is a review-first workbench. Staff confirm template fields, recipient rules and invoice attachments; Outlook Helper creates Classic Outlook drafts; employees review and manually send. Prepared records are viewed in Email Activity.
- Companies inclusion is based on TeamWork Internal CSS Status = Active. CSS Client and Shareholder are additional TeamWork Client-column classifications.
- Recipient rules: external customer emails go to To; Tassure emails go to CC; cindy@tassure.com is excluded; hoechyi@tassure.com is always CC; when kahye@tassure.com appears, sengxin@tassure.com is omitted.
- Data freshness (SGT): TeamWork ND 05:00; TeamWork Companies and campaign recipients 05:30; AR generation 06:00; QuickBooks 06:30; AR workflow 07:00; Late Filing 08:00. Never claim a run succeeded without live evidence; direct staff to Dashboard Automation health when needed.

If the user asks to generate/open/draft/check an invoice for a company, use preview_invoice_draft — it shows exactly what Billing Drafts would pre-fill (company, FYE cycle, each line item and amount, totals, warnings), but it is READ-ONLY: you have no tool that creates a real invoice in QuickBooks. The UI shows the user a real "Generate Invoice" button on the preview itself, with its own confirmation step, PLUS a real "Open in Billing Drafts" link that takes them straight to that company's own edit view on the real page (already found, already open) for when they want to do more than the compact card allows — never say or imply YOU generated, will generate, or are generating the real invoice; tell the user to review the preview and use those when ready. If a FYE year is ambiguous, ask before calling the tool rather than guessing one.

If the user asks about resolving/closing/clearing a company's Late Filing status, use preview_late_filing_resolve the same way — it shows what the record's remarks would become, but is READ-ONLY; the UI shows a real "Mark Resolved" button with its own confirmation, plus an "Open in Late Filing" link to that company's real edit dialog. Same rule: never say or imply YOU resolved it.

If the user asks to change/edit/fix/correct something on an ALREADY-GENERATED invoice (e.g. "change the Secretary line to $700"), use preview_invoice_edit — turn their stated change into the tool's "changes" argument yourself (which line, what new value), never guess a number they didn't give you. It fetches the invoice's real current lines and shows a before/after diff; READ-ONLY, nothing is saved. If it reports unmatchedChanges, tell the user plainly which part of their request didn't match a real line. The UI shows a real "Save Changes" button with its own confirmation, plus an "Open in Billing Drafts" link, same as invoicing above — never say or imply YOU saved the change.

All three of the above tools, when they report a company as not found, return a "suggestions" list where each entry already carries a real, working "link" — a deep link that takes the user straight to that specific company already found and its real editing view already open, not just the bare tab page. Always present these as clickable markdown links using each entry's own "link" value (e.g. "Did you mean [Company Name](that link)?"), never as plain unlinked names the user has to go search for themselves — this is exactly the same "actually help them get there" principle as the real buttons on a successful preview, just for the not-found case.

If the user asks to generate/prepare the Post Incorporate document set for a newly incorporated company, DO NOT ask for everything at once and DO NOT call preview_post_incorporate on a near-empty object just to "see what's missing" — that wastes the user's time reading a wall of errors. Instead run a real guided intake conversation: first collect the company's own details (name, UEN, registered address, registration date, chairman, secretary, currency, FYE, whether ND service is needed — secretaryCompanyName can be left out, it defaults automatically), confirm you have those, THEN walk through each director one at a time (name, address, ID type/number, nationality, DOB, gender, email, phone, whether they're a nominee director — and only if so, their nominator's details), THEN each shareholder one at a time (name/address/ID, shares, whether fully paid-up — and if so, a share certificate number — corporate shareholders need their corporate director names). Keep track of everything collected so far across the conversation yourself (the tool has no memory between calls — you must re-send the FULL picture, everything collected so far, every time you call it, not just what's new). Never invent, guess, infer, or auto-fill any identity value (ID numbers, addresses, dates of birth, share details) — every one of these must come from the user exactly as stated; if something is genuinely unknown, leave it blank and ask, don't make one up to move faster. Only call preview_post_incorporate once you believe the picture is reasonably complete. If it reports complete:false, relay its errors plainly and ask for exactly what's still missing, then call it again once supplied. It is READ-ONLY — there is no tool that generates or downloads the actual documents; the UI shows a real "Generate & Download" button on the resulting preview card. Never say or imply YOU generated or downloaded the documents.

Use tools to answer data questions. Distinguish confirmed live data from general workflow guidance. If the user should go somewhere, include the markdown link. If you don't know or lack row-level context, say so plainly.`;
}

async function dynamicSystemPrompt(context?: AssistantContext, account?: ApprovedAccount | null): Promise<string> {
  // Blueprint section 11 "Context Package": "RELEVANT MEMORY" is one of
  // the pieces every call should carry — a SMALL, targeted slice, never
  // the account's full history dumped in. Capped at 8 for the same reason
  // the Claude tool-result payloads elsewhere in this file stay compact.
  const memories = account ? await listMemories(account.email, 8) : [];
  const memoryBlock = memories.length
    ? `\nThings this user has explicitly asked to be remembered (treat as durable context, not absolute fact if it conflicts with live system data):\n${memories.map(m => `- [${m.memory_type}] ${m.content}`).join('\n')}\n`
    : '';
  return `Current user location:
- Page: ${context?.page ?? 'unknown'}
- Path: ${context?.pathname ?? 'unknown'}

Current logged-in staff member: ${account ? `${account.name} (${account.email})` : 'unknown / not identified'}.
${memoryBlock}`;
}

const CLAUDE_TOOLS = [
  { name: 'search_company', description: 'Look up companies by (partial) name: status, FYE month, services, PIC, active nominee directors, recent AR reminder rows.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'ar_batch', description: 'AR Reminder batch for a FYE month+year: totals and company names.', input_schema: { type: 'object', properties: { month: { type: 'string', description: 'English month name, e.g. April' }, year: { type: 'number' } }, required: ['month', 'year'] } },
  { name: 'nd_lookup', description: 'Look up a nominee director by person name: their active company appointments.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'automation_health', description: 'Read live automation job health and the open integration-exception count.', input_schema: { type: 'object', properties: {} } },
  { name: 'my_tasks_summary', description: "Overdue/due-soon AR Reminder items and Late Filing flags for a staff member. With no `person` argument, returns the CURRENTLY LOGGED-IN caller's own tasks (resolved server-side from their real session). Pass `person` (a name, nickname, or initials, e.g. \"HC\") ONLY when the user explicitly asks about someone ELSE's tasks — this only succeeds if the caller's own account has management view-other-staff permission; otherwise the tool returns an explicit permission-denied message instead of any task data, which must be relayed honestly rather than worked around.", input_schema: { type: 'object', properties: { person: { type: 'string', description: "Optional: another staff member's name, nickname, or initials — only set this when the user is asking about someone other than themselves." } } } },
  { name: 'my_activity_pattern', description: "The currently logged-in staff member's own real page-visit/action history over the last 30 days (most-visited pages, most common key actions, hour-of-day activity) — for questions about their own habits, not anyone else's. May report no_data if tracking hasn't accumulated enough history yet.", input_schema: { type: 'object', properties: {} } },
  { name: 'recent_activity_summary', description: "A real audit-trail activity summary — invoices generated, AR Reminder edits, email campaigns created, Master List edits, sent client emails, Post Incorporate docs generated, Trademark record edits, SOA owner picks. NOT page-view tracking (that's my_activity_pattern) — this is what someone has actually DONE across the system's real features, with history predating today. With no `person` argument, returns the CURRENTLY LOGGED-IN caller's own activity. Pass `person` (name/nickname/initials) to ask about someone ELSE — same management-only permission and same refusal behavior as my_tasks_summary's `person` argument.", input_schema: { type: 'object', properties: { person: { type: 'string', description: "Optional: another staff member's name, nickname, or initials." } } } },
  { name: 'remember_this', description: "Save something the user has EXPLICITLY asked to be remembered for future conversations (e.g. a stated preference, a fact about their role, a standing instruction). Only call this when the user directly asks to be remembered/noted — never infer one from conversational tone.", input_schema: { type: 'object', properties: { memory_type: { type: 'string', enum: ['fact', 'preference', 'behaviour', 'relationship', 'project', 'decision', 'rejection', 'pattern'] }, content: { type: 'string', description: 'The fact/preference itself, written as a short standalone statement.' } }, required: ['memory_type', 'content'] } },
  { name: 'preview_invoice_draft', description: "READ-ONLY preview of what a TAB/TAC Billing Drafts invoice would look like for one company — same pre-fill rules as the real page (prior invoice, renewal/annual status, carried-forward Discount/Accounts/Tax lines). Does NOT create anything in QuickBooks; there is no tool available that can. Use whenever the user asks to see/check/preview/'draft'/'open' an invoice for a company. If the company can't be found, suggestions are returned — offer them rather than giving up.", input_schema: { type: 'object', properties: { company: { type: 'string', description: 'Company name, partial match is fine' }, fyeYear: { type: 'number', description: 'Optional: calendar year of the FYE cycle to preview — defaults to the current year' } }, required: ['company'] } },
  { name: 'preview_late_filing_resolve', description: "READ-ONLY preview of what marking a Late Filing record 'Resolved' would set its remarks to, for one company currently on the Late Filing list — same rule the real page's own Resolve button uses. Does NOT change anything; there is no tool available that can. Use whenever the user asks about resolving/closing/clearing a company's Late Filing status. If the company can't be found, suggestions are returned.", input_schema: { type: 'object', properties: { company: { type: 'string', description: 'Company name, partial match is fine' } }, required: ['company'] } },
  { name: 'preview_invoice_edit', description: "READ-ONLY preview of a change to a REAL, already-generated invoice for one company this cycle (e.g. 'change the Secretary line to $700', 'set the AR line qty to 2'). Fetches the invoice's real current lines from QuickBooks, applies the stated change(s) to a copy, and returns a before/after diff. Does NOT save anything to QuickBooks; there is no tool available that can. Only works on an invoice that was already generated for the company's CURRENT cycle — if none exists, say so (the user should generate one first via preview_invoice_draft). Turn the user's stated change into the `changes` array yourself — match by `service` (Secretary/Address/ND/AR/XBRL/Accounts/Tax/Discount) when the user names a service, or `matchDescription` (a substring of the real line description) when they don't. Never guess a numeric value the user didn't state.", input_schema: { type: 'object', properties: {
    company: { type: 'string', description: 'Company name, partial match is fine' },
    qbCompany: { type: 'string', enum: ['TAB', 'TAC'], description: "Optional: which QuickBooks company's invoice to edit, if the user specified (ND lines are always TAC, everything else TAB). Omit if there's only one invoice this cycle." },
    changes: {
      type: 'array',
      description: 'One entry per line the user wants changed.',
      items: { type: 'object', properties: {
        service: { type: 'string', description: 'Which service line to target, e.g. "Secretary"' },
        matchDescription: { type: 'string', description: 'Fallback: a substring of the real line description, if service alone would be ambiguous or unknown' },
        newRate: { type: 'number', description: 'New unit rate, if the user asked to change the amount' },
        newQty: { type: 'number', description: 'New quantity, if the user asked to change it' },
        newDescription: { type: 'string', description: 'New description text, if the user asked to change it' },
      } },
    },
  }, required: ['company', 'changes'] } },
  { name: 'preview_post_incorporate', description: "Guided-intake validator for a new company's Post Incorporate document set (16 real Word documents: board resolution, director consents, share certificates, secretary appointment, ND declarations, etc). This is NOT a one-shot call — conduct a multi-turn conversation collecting the real details a few at a time (company info first, then each director's real details, then each shareholder's), and only call this tool once you believe the picture is complete. It is READ-ONLY: it validates and returns a summary, but creates nothing — there is no tool available that can generate or download the actual documents. NEVER invent, guess, or infer any value yourself — especially identification numbers (NRIC/FIN/passport/UEN), addresses, dates of birth, and share details — every one of these must come from the user exactly as they state it. If the tool reports complete:false, relay its errors/message honestly and ask the user for exactly what's missing; call the tool again once they've supplied it. `secretaryCompanyName` defaults to Tassure's own fixed registered name if not given — don't ask the user for it unless they want to override it. Pass every field you've collected so far each time, even if incomplete, so the tool can tell you precisely what's still missing.", input_schema: { type: 'object', properties: {
    company: { type: 'object', description: "Company-level info. Strictly required: name, uen, regDate (ISO yyyy-mm-dd), at least one director with a name, and chairmanName must exactly match one director's name.", properties: {
      name: { type: 'string' }, uen: { type: 'string' }, address: { type: 'string', description: 'Registered office address' },
      regDate: { type: 'string', description: 'ISO yyyy-mm-dd incorporation/registration date' },
      chairmanName: { type: 'string', description: "Must exactly match one director's name" },
      secretaryName: { type: 'string', description: 'The named company secretary (a Tassure staff member)' },
      secretaryCompanyName: { type: 'string', description: "Tassure's own registered secretarial-firm name — omit to use the default" },
      secretaryCompanyAddress: { type: 'string', description: "Tassure's own registered office address for this engagement — ask the user, do not guess (Tassure has several real office locations)" },
      currency: { type: 'string', description: 'Defaults to SGD if omitted' },
      financialYearEndDayMonth: { type: 'string', description: 'e.g. "31 December"' },
      needNdService: { type: 'boolean', description: 'Whether this company needs Nominee Director service' },
    } },
    directors: { type: 'array', description: 'At least one director with a non-empty name is required.', items: { type: 'object', properties: {
      name: { type: 'string' }, address: { type: 'string' }, identificationType: { type: 'string', description: 'e.g. NRIC / PASSPORT / FIN' },
      identificationNumber: { type: 'string' }, nationality: { type: 'string' }, dateOfBirth: { type: 'string', description: 'ISO yyyy-mm-dd' },
      gender: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' },
      isNomineeDirector: { type: 'boolean' },
      nominatorType: { type: 'string', enum: ['individual', 'corporate entity', ''], description: 'Only relevant when isNomineeDirector is true' },
      nominatorIndName: { type: 'string' }, nominatorIndAddress: { type: 'string' }, nominatorIndNationality: { type: 'string' },
      nominatorIndIdentificationNumber: { type: 'string' }, nominatorIndBirthDate: { type: 'string' }, nominatorIndEmail: { type: 'string' },
      nominatorIndContactNumber: { type: 'string' }, nominatorIndDateBecameNominator: { type: 'string' },
      nominatorCorpName: { type: 'string' }, nominatorCorpUen: { type: 'string' }, nominatorCorpRegisteredAddress: { type: 'string' },
      nominatorCorpLegalForm: { type: 'string' }, nominatorCorpRepresentative: { type: 'string' }, nominatorCorpEmail: { type: 'string' },
      nominatorCorpContactNumber: { type: 'string' }, nominatorCorpDateBecameNominator: { type: 'string' },
    } } },
    shareholders: { type: 'array', description: 'A UEN (corporate) shareholder needs at least one corporateDirectorNames entry; a fullyPaidUp shareholder needs a unique shareCertificateNo.', items: { type: 'object', properties: {
      name: { type: 'string' }, address: { type: 'string' }, identificationType: { type: 'string', description: 'e.g. NRIC / PASSPORT / FIN / UEN (UEN = corporate shareholder)' },
      identificationNumber: { type: 'string' }, numberOfShares: { type: 'string' }, paidUpCapital: { type: 'string' },
      fullyPaidUp: { type: 'boolean' }, shareCertificateNo: { type: 'string', description: 'Required and must be unique if fullyPaidUp is true' },
      corporateDirectorNames: { type: 'array', items: { type: 'string' }, description: 'Required (at least one) when identificationType is UEN' },
      corpRepresentative: { type: 'string' }, corpRepIdType: { type: 'string' }, corpRepIdNo: { type: 'string' },
      isNomineeShareholder: { type: 'boolean' },
      nominatorType: { type: 'string', enum: ['individual', 'corporate entity', ''] },
      nominatorIndName: { type: 'string' }, nominatorIndAddress: { type: 'string' }, nominatorIndNationality: { type: 'string' },
      nominatorIndIdentificationNumber: { type: 'string' }, nominatorIndBirthDate: { type: 'string' }, nominatorIndEmail: { type: 'string' },
      nominatorIndContactNumber: { type: 'string' }, nominatorIndDateBecameNominator: { type: 'string' },
      nominatorCorpName: { type: 'string' }, nominatorCorpUen: { type: 'string' }, nominatorCorpRegisteredAddress: { type: 'string' },
      nominatorCorpLegalForm: { type: 'string' }, nominatorCorpRepresentative: { type: 'string' }, nominatorCorpEmail: { type: 'string' },
      nominatorCorpContactNumber: { type: 'string' }, nominatorCorpDateBecameNominator: { type: 'string' },
    } } },
  }, required: ['company', 'directors', 'shareholders'] } },
];

async function runTool(name: string, input: Record<string, unknown>, account: ApprovedAccount | null) {
  if (name === 'search_company') return searchCompany(String(input.query ?? ''));
  if (name === 'ar_batch') return arBatch(String(input.month ?? ''), Number(input.year ?? 0));
  if (name === 'nd_lookup') return ndLookup(String(input.name ?? ''));
  if (name === 'automation_health') return automationHealth();
  if (name === 'my_tasks_summary') return myTasksSummary(account, typeof input.person === 'string' ? input.person : undefined);
  if (name === 'my_activity_pattern') return myActivityPattern(account);
  if (name === 'recent_activity_summary') return recentActivitySummary(account, typeof input.person === 'string' ? input.person : undefined);
  if (name === 'remember_this') return rememberThis(account, String(input.memory_type ?? ''), String(input.content ?? ''));
  if (name === 'preview_invoice_draft') return invoiceDraftPreview(account, String(input.company ?? ''), typeof input.fyeYear === 'number' ? input.fyeYear : undefined);
  if (name === 'preview_late_filing_resolve') return lateFilingResolvePreview(account, String(input.company ?? ''));
  if (name === 'preview_invoice_edit') {
    const qbCompany = input.qbCompany === 'TAB' || input.qbCompany === 'TAC' ? input.qbCompany : undefined;
    const changes = Array.isArray(input.changes) ? input.changes as InvoiceEditChange[] : [];
    return invoiceEditPreview(account, String(input.company ?? ''), qbCompany, changes);
  }
  if (name === 'preview_post_incorporate') return postIncorporatePreview(account, input);
  return { error: 'unknown tool' };
}

async function claudeAnswer(messages: Msg[], context?: AssistantContext, account?: ApprovedAccount | null): Promise<{ text: string; invoicePreview?: InvoicePreview; lateFilingPreview?: LateFilingResolvePreview; invoiceEditPreview?: InvoiceEditPreview; postIncorporatePreview?: PostIncorporatePreview }> {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const convo: Record<string, unknown>[] = messages.map(m => ({ role: m.role, content: m.content }));
  // Two blocks, not one interpolated string — see staticSystemPrompt's own
  // comment. Only the static block (and CLAUDE_TOOLS ahead of it, cached
  // as part of the same prefix) carries cache_control; the dynamic block
  // is small and cheap to send fresh every call.
  const system = [
    { type: 'text', text: staticSystemPrompt(), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: await dynamicSystemPrompt(context, account) },
  ];
  // Captures the LAST successful preview_invoice_draft result across the
  // tool-use loop (2026-09-08 — see invoiceDraftPreview's own comment) so
  // it can ride along with the text reply as structured data for the
  // frontend's real "Confirm & Generate" card — Claude's own prose is for
  // the user to read, not something the UI should try to parse back apart.
  let lastInvoicePreview: InvoicePreview | undefined;
  let lastLateFilingPreview: LateFilingResolvePreview | undefined;
  let lastInvoiceEditPreview: InvoiceEditPreview | undefined;
  let lastPostIncorporatePreview: PostIncorporatePreview | undefined;
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system, tools: CLAUDE_TOOLS, messages: convo }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const toolUses = (data.content as Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }>).filter(b => b.type === 'tool_use');
    if (!toolUses.length || data.stop_reason !== 'tool_use') {
      const text = (data.content as Array<{ type: string; text?: string }>).filter(b => b.type === 'text').map(b => b.text).join('\n') || '(无回复)';
      return { text, invoicePreview: lastInvoicePreview, lateFilingPreview: lastLateFilingPreview, invoiceEditPreview: lastInvoiceEditPreview, postIncorporatePreview: lastPostIncorporatePreview };
    }
    convo.push({ role: 'assistant', content: data.content });
    const results = [];
    for (const tu of toolUses) {
      // A single tool's own failure (e.g. remember_this before its table's
      // migration has run) must not derail the whole conversation turn —
      // without this, it would bubble out of claudeAnswer() and land the
      // OUTER catch in POST() below, silently swapping this reply to the
      // plain intent-router engine mid-conversation, which has no
      // equivalent handling and would answer something unrelated.
      let result: unknown;
      try {
        result = await runTool(tu.name!, tu.input ?? {}, account ?? null);
        if (tu.name === 'preview_invoice_draft' && result && typeof result === 'object' && (result as { found?: boolean }).found) {
          lastInvoicePreview = (result as { preview: InvoicePreview }).preview;
        }
        if (tu.name === 'preview_late_filing_resolve' && result && typeof result === 'object' && (result as { found?: boolean }).found) {
          lastLateFilingPreview = (result as { preview: LateFilingResolvePreview }).preview;
        }
        if (tu.name === 'preview_invoice_edit' && result && typeof result === 'object' && (result as { found?: boolean }).found) {
          lastInvoiceEditPreview = (result as { preview: InvoiceEditPreview }).preview;
        }
        if (tu.name === 'preview_post_incorporate' && result && typeof result === 'object' && (result as { complete?: boolean }).complete) {
          lastPostIncorporatePreview = (result as { preview: PostIncorporatePreview }).preview;
        }
      } catch (err) {
        result = { error: err instanceof Error ? err.message : 'tool failed' };
      }
      results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 6000) });
    }
    convo.push({ role: 'user', content: results });
  }
  return { text: '抱歉,这个问题查询步骤太多,请换个更具体的问法。', invoicePreview: lastInvoicePreview, lateFilingPreview: lastLateFilingPreview, invoiceEditPreview: lastInvoiceEditPreview, postIncorporatePreview: lastPostIncorporatePreview };
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

async function intentAnswer(text: string, context?: AssistantContext, account?: ApprovedAccount | null): Promise<string> {
  const t = text.toLowerCase().trim();

  // Current-page help: the widget sends its location so vague questions do
  // not fall through to a generic answer. English branch added 2026-09-08
  // after Vincent screenshotted the My Tasks empty state's own "How does
  // this work?" suggestion button silently missing every branch and
  // landing on the generic capability list — this router is otherwise
  // Chinese-oriented, but that button's exact English text is now real,
  // clickable UI, not just something a user might type, so it has to work.
  if (/(这个页面|这页|当前页面|这里).*(怎么用|做什么|有什么|如何|说明|帮助)|(怎么用|如何使用).*(这个页面|这页|这里)|how (does|do i use) this (page|work)/.test(t)) {
    return currentPageHelp(context?.pathname);
  }

  // Vincent, 2026-09-08: "更智能的分析和判断用户要做什么...可以沟通，可以
  // 对话" — checked BEFORE the automation-health branch below, since a
  // phrase like "今天要优先做什么" would otherwise get swallowed by that
  // branch's own "今天.*处理" pattern. Works with no ANTHROPIC_API_KEY set
  // (this whole function is the no-key fallback engine) by reusing the
  // exact rule-based sentence lib/my-tasks-brief.ts's own generateMyTasksBrief()
  // falls back to — never a second, differently-worded summary of the
  // same data.
  //
  // Widened same day, after Vincent screenshotted 2 of the My Tasks empty
  // state's own real suggestion buttons failing in production (no
  // ANTHROPIC_API_KEY set there, confirmed by that exact screenshot, so
  // this router — not Claude — is what actually answers): "What should I
  // prioritize today?" matched nothing (missing "prioritize" as a verb —
  // "do"/"focus" aren't the only ways to ask this), and "Any overdue AR?"
  // was quietly stolen by the due-soon branch further below (its own
  // /(到期|due|...)/ pattern matches the "due" INSIDE "overdue" as a
  // substring) — answering with a generic company-wide due-soon list
  // instead of this specific person's own overdue items. Both fixed by
  // adding these exact phrasings here, checked before due-soon can ever
  // see them.
  //
  // Widened AGAIN same day for "如果我是HC，我要做什么今天？" (Vincent's
  // own real query, screenshotted still falling through to the generic
  // fallback) — "我要做什么" wasn't recognized at all (only "我该做什么"
  // was), added as its own alternative below.
  if (/(我的任务|我今天|今天.*优先|优先.*处理|my tasks?|what should i (do|focus|prioritize|work on)|prioriti[sz]e today|我该(做|处理)什么|我要(做|处理)什么|需要处理什么|overdue ar|any overdue|my overdue|哪些逾期|逾期.*ar)/.test(t)) {
    if (!account) return '我认不出你目前的登录账号，请确认已登录后再试一次。\n\n[打开 My Tasks](/my-tasks)';

    // Cross-person: "如果我是HC，我要做什么今天？" — Vincent, 2026-09-08:
    // "我是最大的ADMIN，和管理层就可以问这些问题，其他人一般只能问自己相
    // 关的东西". Matched against the ORIGINAL-case `text`, not the
    // lowercased `t` used above — short initials like "HC"/"JF" are only
    // matched case-sensitively (see findMentionedAccount's own doc
    // comment), and lowercasing would break that. A mention of the
    // caller's own name/alias isn't a cross-person query at all (falls
    // through with `target` left as `account`, no permission check
    // needed). An explicit "如果我是X"/"if I were X" hypothesis that
    // fails to resolve gets an honest "don't recognize that person"
    // reply instead of silently defaulting to the caller's own tasks,
    // which would otherwise look like it answered the question asked.
    let target = account;
    const mentioned = findMentionedAccount(text);
    if (!mentioned && /(如果我是|假如我是|if i (?:were|was))/i.test(text)) {
      return '我在系统里找不到你说的这位同事，请用完整姓名或已知的简称再试一次（例如 "Lim Hoe Chyi" 或 "HC"）。\n\n[打开 My Tasks](/my-tasks)';
    }
    if (mentioned && mentioned.email !== account.email) {
      if (!account.canViewAsOthers) {
        return `你的账号只能查询自己的任务，无法查看 ${mentioned.name} 的任务——这项权限仅开放给管理层。\n\n[打开 My Tasks](/my-tasks)`;
      }
      target = mentioned;
    }

    const tasks = await computeMyTasks(target);
    const brief = await generateMyTasksBrief(tasks, target.name);
    const prefix = target.email !== account.email ? `**${target.name} 的任务：**\n` : '';
    return `${prefix}${brief}\n\n[打开 My Tasks 查看详情](/my-tasks)`;
  }

  // Vincent, 2026-09-08, same day: "为什么这个用户每天会打开这个页面，为什
  // 么会时常在这个页面操作" — real recorded page-visit/action history
  // (lib/activity-data.ts), only from the day this tracking shipped
  // onward. Honest about having nothing to say yet rather than guessing a
  // pattern from no data — matches my_activity_pattern's own no_data path
  // in the Claude engine above.
  if (/(我的习惯|使用习惯|我最常|我常常|我经常|为什么我.*(打开|访问|操作)|我什么时候最活跃|activity pattern|my habits?)/.test(t)) {
    if (!account) return '我认不出你目前的登录账号，请确认已登录后再试一次。';
    const summary = await getPersonActivitySummary(account.email, 30);
    if (summary.totalEvents === 0) return '这项追踪是从今天新上线的，目前还没有累积到足够的真实使用记录，暂时回答不了这个问题——用一段时间之后再问我。';
    const topPage = summary.topPages[0];
    const topAction = summary.topActions[0];
    const lines = [`过去${summary.rangeDays}天，你一共有${summary.totalEvents}次记录。`];
    if (topPage) lines.push(`你最常打开的页面是 ${topPage.pathname}（${topPage.visits}次）。`);
    if (topAction) lines.push(`你最常做的操作是 ${topAction.eventType}（${topAction.count}次）。`);
    return lines.join(' ');
  }

  // Vincent, 2026-09-08, on the View-as-Chelsea screen showing 0 tasks
  // despite her real daily use: "没有真正了解到...我们的员工在做什么" —
  // real audit-trail activity (lib/recent-activity.ts), checked separately
  // from the page-visit "习惯" branch just above (different question: "what
  // has this person actually DONE" vs "which pages do they visit"). Also
  // checked before the generic company-lookup branches further below, so
  // "Chelsea最近做了什么" doesn't get misread as a company-name search.
  // Supports the same cross-person lookup as the my-tasks branch above,
  // same permission, same explicit-refusal-over-silent-fallback behaviour.
  if (/(最近.*(做了什么|在做什么|做过什么|活动)|活动记录|最近动态|recent activity|activity (history|log|summary)|what (has|have) .*(been doing|done))/i.test(t)) {
    if (!account) return '我认不出你目前的登录账号，请确认已登录后再试一次。';
    let target = account;
    const mentioned = findMentionedAccount(text);
    if (mentioned && mentioned.email !== account.email) {
      if (!account.canViewAsOthers) {
        return `你的账号只能查询自己的活动记录，无法查看 ${mentioned.name} 的——这项权限仅开放给管理层。`;
      }
      target = mentioned;
    }
    const items = await getRecentActivity(target.email, 25);
    const whoLabel = target.email !== account.email ? `${target.name} ` : '你';
    if (!items.length) {
      return `${whoLabel}目前没有可显示的活动记录——这是根据真实的系统操作（开票/AR编辑/邮件Campaign/Master List等），不是页面访问记录，如果这个人主要工作不在这些功能上，看到空白是正常的，不代表追踪坏了。`;
    }
    const byKind = summarizeByKind(items);
    const lines = [
      `**${whoLabel === '你' ? '你的' : `${whoLabel}的`}最近活动**（共 ${items.length} 条真实记录）`,
      '',
      ...byKind.map(k => `· ${k.label}：${k.count} 次`),
      '',
      '最近几条：',
      ...items.slice(0, 5).map(i => `· ${i.at.slice(0, 10)} — ${i.label} — ${i.detail}`),
      '',
      '[打开 My Tasks 查看完整时间线](/my-tasks)',
    ];
    return lines.join('\n');
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
    '· **我的任务** — 如 "我今天要优先处理什么"（按你自己的登录账号回答）',
    '· **Email Drafts** — 如 "为什么这行还不能 Ready"',
    '· **Outlook Helper** — 如 "Helper 怎么安装和检查"',
    '· **页面导航** — 如 "打开开单草稿"',
    '· **流程问题** — 如 "怎么开单"、"To 和 CC 的规则是什么"、"Prepared 后去哪里看"',
    '',
    `快捷入口:${PAGES.slice(0, 5).map(p => `[${p.label}](${p.href})`).join(' ')} [Email Drafts](/client-communications/campaigns)`,
  ].join('\n');
}

// Persists this exchange into a saved thread — Vincent: "My Tasks 这个页
// 面是好像AI聊天这样的界面...记录Chats". Ownership-checked against the
// real session; an invalid/foreign id just means "don't persist," never
// an error that would fail the chat reply itself — the reply is still
// good even if saving it somewhere failed. Auto-titles from the first
// real user message (ChatGPT-style), never overwriting a title the user
// (or a later save) already set.
async function persistExchange(conversationId: number | undefined, account: ApprovedAccount | null, userMessage: string, reply: string, isFirstMessage: boolean) {
  if (!conversationId || !account) return;
  try {
    const owner = await getConversationOwner(conversationId);
    if (owner !== account.email) return;
    await appendMessage(conversationId, 'user', userMessage);
    await appendMessage(conversationId, 'assistant', reply);
    if (isFirstMessage) await renameConversation(conversationId, deriveTitle(userMessage));
    else await touchConversation(conversationId);
  } catch {
    // Persistence is a nice-to-have on top of a reply that already
    // succeeded — never surface this as a failure to the caller.
  }
}

// ── Route ────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { messages, context, conversationId, viewAs } = (await req.json().catch(() => ({}))) as {
    messages?: Msg[];
    context?: AssistantContext;
    conversationId?: number;
    viewAs?: string;
  };
  if (!messages?.length) return NextResponse.json({ error: 'messages required' }, { status: 400 });

  // 2026-09-08: this route was fully anonymous before — no personal-task
  // question could ever be answered safely. getRequestAccount() reads the
  // real session cookie the same way every other protected route does;
  // null here just means "couldn't identify this caller" (not logged in,
  // or an unapproved account), handled explicitly by my_tasks_summary /
  // the intent-router branch above rather than silently guessing.
  const realAccount = await getRequestAccount(req).catch(() => null);

  // "View As" identity substitution for chat (same day, extended from the
  // Tasks-tab-only picker) — Vincent: "我作为最大的ADMIN 甚至是要可以带入
  // 到那个员工的身份，去开一个NEW CHAT 在她的记录...通过View as". When the
  // frontend sends `viewAs` (My Tasks' own picker), EVERYTHING below —
  // tool calls, the system prompt's "current logged-in staff member",
  // conversation persistence — operates as the TARGET, not the real
  // caller. A bad/unauthorized viewAs is a hard error, never a silent
  // fall-back to the caller's own identity (that would answer/save under
  // the wrong person without saying so).
  let account = realAccount;
  if (realAccount && viewAs) {
    const resolution = resolveViewAsAccount(realAccount, viewAs);
    if (!resolution.ok) return NextResponse.json({ error: resolution.message }, { status: resolution.status });
    account = resolution.account;
  }

  const last = messages[messages.length - 1];
  const isFirstMessage = messages.length === 1;
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      // Widened from 8 to 24 (2026-09-09, alongside preview_post_incorporate)
      // — a guided intake conversation (company info, then each director,
      // then each shareholder) genuinely needs more turns of real history
      // than the other, single-shot preview tools ever did; losing an
      // earlier-collected director's details off the back of an 8-message
      // window would make Claude re-ask for them or, worse, guess.
      const { text: reply, invoicePreview, lateFilingPreview, invoiceEditPreview, postIncorporatePreview } = await claudeAnswer(messages.slice(-24), context, account);
      await persistExchange(conversationId, account, last.content, reply, isFirstMessage);
      return NextResponse.json({ reply, engine: 'claude', invoicePreview, lateFilingPreview, invoiceEditPreview, postIncorporatePreview });
    }
    const reply = await intentAnswer(last.content, context, account);
    await persistExchange(conversationId, account, last.content, reply, isFirstMessage);
    return NextResponse.json({ reply, engine: 'intent' });
  } catch (e) {
    // Claude path failed (bad key / network) — degrade to the intent engine.
    try {
      const reply = await intentAnswer(last.content, context, account);
      await persistExchange(conversationId, account, last.content, reply, isFirstMessage);
      return NextResponse.json({ reply, engine: 'intent-fallback', note: e instanceof Error ? e.message : 'claude failed' });
    } catch {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'assistant failed' }, { status: 500 });
    }
  }
}
