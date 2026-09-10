import 'server-only';

import { getUpcomingDeadlines } from './deadlines-lookup';
import { getLateFilingSummary } from './late-filing-lookup';
import { summarizeOutstandingBalance } from './outstanding-lookup';
import type { QbCompany } from './quickbooks';

// Added 2026-09-10 — the chat UI's own top suggested prompt is "What should
// I prioritize today?", but the only tool behind it (my_tasks_summary) shows
// the CALLER's own AR + Late Filing rows. Verified on production: for
// Vincent that returns everAssigned=false / total=0, because an owner isn't
// a caseworker — so the headline suggestion answered "you've never been
// assigned anything". Nothing combined the three things that actually make
// up "what needs attention": deadlines, money owed, and late filing.
//
// Composes the EXISTING computations rather than re-deriving any of them, so
// a number here can never disagree with the tool that owns it. Deliberately
// returns counts + a few worst examples, not full lists — this is the
// "where should I look" answer; the specific tools give the detail.
export type FirmPulse = {
  today: string;
  deadlines: {
    overdueArFilings: number;
    overdueAgms: number;
    dueNext14Days: number;
    worstOverdue: { companyName: string; dueDate: string; daysOverdue: number; kind: string; pic: string | null }[];
  };
  lateFiling: { activeOverdue: number; serious: number; topPic: { pic: string; count: number } | null };
  money: { totalOutstanding: number; customersOwing: number; biggestDebtors: { companyName: string; totalOutstanding: number; qbCompany: string }[] };
};

export async function getFirmPulse(): Promise<FirmPulse> {
  const books: QbCompany[] = ['TAB', 'TAC', 'TAO'];
  const [deadlines, late, outstanding] = await Promise.all([
    getUpcomingDeadlines(14),
    getLateFilingSummary(),
    summarizeOutstandingBalance(books),
  ]);

  const overdueAr = deadlines.countsByKind.find(c => c.kind === 'ar_filing')?.overdue ?? 0;
  const overdueAgm = deadlines.countsByKind.find(c => c.kind === 'agm')?.overdue ?? 0;
  const dueSoon = deadlines.countsByKind.reduce((n, c) => n + c.upcoming, 0);

  const allDebtors = outstanding.flatMap(s => s.topDebtors.map(d => ({ ...d, qbCompany: s.qbCompany })));

  return {
    today: deadlines.today,
    deadlines: {
      overdueArFilings: overdueAr,
      overdueAgms: overdueAgm,
      dueNext14Days: dueSoon,
      worstOverdue: deadlines.overdue.slice(0, 5).map(i => ({
        companyName: i.companyName, dueDate: i.dueDate, daysOverdue: Math.abs(i.daysUntilDue), kind: i.kind, pic: i.pic,
      })),
    },
    lateFiling: {
      activeOverdue: late.activeOverdue,
      serious: late.byCategory.find(c => c.category === 'serious')?.count ?? 0,
      topPic: late.byPic[0] ? { pic: late.byPic[0].pic, count: late.byPic[0].count } : null,
    },
    money: {
      totalOutstanding: outstanding.reduce((sum, s) => sum + s.totalOutstanding, 0),
      customersOwing: outstanding.reduce((sum, s) => sum + s.companyCount, 0),
      biggestDebtors: allDebtors.sort((a, b) => b.totalOutstanding - a.totalOutstanding).slice(0, 5)
        .map(d => ({ companyName: d.companyName, totalOutstanding: d.totalOutstanding, qbCompany: d.qbCompany })),
    },
  };
}
