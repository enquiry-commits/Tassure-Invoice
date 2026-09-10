// Regression guard for the chat surface's pure-render behavior — added
// 2026-09-10 after a markdown horizontal rule ('---') rendered as a
// literal "• --" bullet in production, twice, unnoticed. These components
// are plain functions of their props, so react-dom/server renders them
// with no browser and no dev server (this machine cannot afford either —
// see the lightweight-verification note in CLAUDE memory).
//
// Run: npx tsx test-chat-render.tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { RichText } from './components/assistant/ChatRichText';
import { ListExportCard, SoaCard, EmailDraftCard, CompanyUpdateCard } from './components/assistant/ChatCards';

const render = (t: string) => renderToStaticMarkup(<RichText text={t} onNav={() => {}} />);

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : ' -- ' + detail));
  if (!cond) fail++;
};

// The exact artifact from Vincent's screenshots
const hr = render('第一段\n---\n第二段');
check('a standalone --- is NOT rendered as a bullet', !hr.includes('•'), hr);
check('a standalone --- renders a divider', hr.includes('height:1px'), hr);
check('surrounding text survives', hr.includes('第一段') && hr.includes('第二段'));

check('*** is a rule too', !render('a\n***\nb').includes('•'));
check('___ is a rule too', !render('a\n___\nb').includes('•'));

// Real bullets must still work
const b = render('- 真的项目符号\n· 另一个');
check('real bullets still render', (b.match(/•/g) ?? []).length === 2, b);
check('bullet text preserved', b.includes('真的项目符号'));

// Empty bullet dropped
check('empty bullet is dropped', !render('-  ').includes('•'), render('-  '));

// A real table must be unaffected (its separator IS dashes)
const tbl = render('| A | B |\n|---|---|\n| 1 | 2 |');
check('markdown table still renders as a table', tbl.includes('<table'), tbl.slice(0, 200));
check('table separator did not become a divider', (tbl.match(/height:1px/g) ?? []).length === 0);

// A negative-number line must not be eaten
check('a dash with content is still a bullet', render('- -5 度').includes('•'));


// ── The action cards: they must render, show the real values, and get
// their disabled states right. Every one of these owns a real write, so a
// card that renders a live button when it should be disabled is the
// failure that matters.
const exportCard = renderToStaticMarkup(
  <ListExportCard offer={{ spec: { kind: 'late_filing' }, label: '完整迟报名单 Excel（16 行）', count: 16 }} />,
);
check('export card shows its real label', exportCard.includes('完整迟报名单 Excel（16 行）'), exportCard);

const soa = renderToStaticMarkup(
  <SoaCard preview={{
    companyName: '1V CAPITAL PTE. LTD.', totalOutstanding: 3650,
    lines: [
      { qbCompany: 'TAB', totalOutstanding: 1000, invoiceCount: 1, oldestAgingBucketLabel: '31-60', owner: 'Chin Kah Ye', unpaidInvoices: [{ invoiceNo: '02610894', dueDate: '2026-07-31' }] },
      { qbCompany: 'TAO', totalOutstanding: 2650, invoiceCount: 1, oldestAgingBucketLabel: '61-90', owner: 'Lee Jing Fei', unpaidInvoices: [{ invoiceNo: '02660519', dueDate: '2026-07-08' }] },
    ],
  }} />,
);
check('SOA card totals both books', soa.includes('S$3,650.00'), soa.slice(0, 300));
check('SOA card shows each book', soa.includes('TAB') && soa.includes('TAO'));
check('SOA card offers both real actions', soa.includes('下载 SOA PDF') && soa.includes('起草邮件'));
check('SOA card shows the real invoice numbers', soa.includes('02610894') && soa.includes('02660519'));

const mailBase = {
  companyName: '1V CAPITAL PTE. LTD.', type: 'soa' as const,
  toEmail: 'client@example.com', ccEmail: 'kahye@tassure.com', contactName: 'Client',
  recipientSource: 'teamwork_report' as const, recipientReviewRequired: false,
  invoiceCount: 1, invoiceNumbers: ['02610894'], totalAmount: 1000,
  autoIncluded: true, autoReason: null, templateName: 'SOA1', canDraft: true, blockedReason: null,
};
const mailOk = renderToStaticMarkup(<EmailDraftCard preview={mailBase} />);
check('email card shows the resolved To', mailOk.includes('client@example.com'));
check('email card shows the CC', mailOk.includes('kahye@tassure.com'));
check('email card button is live when it can draft', mailOk.includes('起草邮件并打开发送窗口') && !mailOk.includes('disabled='), mailOk.slice(0, 200));

const mailBlocked = renderToStaticMarkup(
  <EmailDraftCard preview={{ ...mailBase, toEmail: null, canDraft: false, blockedReason: 'No valid recipient email on file for this company.' }} />,
);
check('email card disables the button with no recipient', mailBlocked.includes('disabled='), mailBlocked.slice(0, 200));
check('email card explains why it is blocked', mailBlocked.includes('No valid recipient email on file for this company.'));

const warned = renderToStaticMarkup(
  <EmailDraftCard preview={{ ...mailBase, recipientSource: 'company_fallback', autoIncluded: false, autoReason: 'Already sent this cycle' }} />,
);
check('email card warns on a fallback recipient', warned.includes('备用邮箱'));
check('email card surfaces "Already sent this cycle"', warned.includes('Already sent this cycle'));

const svc = renderToStaticMarkup(
  <CompanyUpdateCard
    preview={{
      companyId: 1, companyName: '1V CAPITAL PTE. LTD.', field: 'service:xbrl', fieldLabel: 'XBRL 服务',
      autoValue: false, currentDisplay: 'OFF（自动判断：OFF，人工覆盖：无）', proposedDisplay: '强制 ON（人工覆盖，同步不会改动它）',
      proposedValue: true, endpoint: '/api/companies/service-override', alreadyThatValue: false,
      warning: 'services_manual 只由这个接口写入，任何自动同步都不会再纠正它。',
    }}
    onDone={() => {}}
  />,
);
check('company card shows before and after', svc.includes('自动判断') && svc.includes('强制 ON'));
check('company card surfaces the no-self-healing warning', svc.includes('任何自动同步都不会再纠正它'));

const noop = renderToStaticMarkup(
  <CompanyUpdateCard
    preview={{
      companyId: 1, companyName: 'X', field: 'customer_source', fieldLabel: '客户来源', autoValue: null,
      currentDisplay: 'Referral', proposedDisplay: 'Referral', proposedValue: 'referral',
      endpoint: '/api/companies/customer-source', alreadyThatValue: true, warning: null,
    }}
    onDone={() => {}}
  />,
);
check('company card disables a no-op change', noop.includes('已经是这个值') && noop.includes('disabled='), noop.slice(0, 200));

console.log(fail === 0 ? '\n=== ALL PASSED ===' : `\n=== ${fail} FAILED ===`);
process.exit(fail === 0 ? 0 : 1);
