import { AlertTriangle, Calendar, FileText, Mail, ScrollText, Stamp, Users, UserCog, PieChart } from 'lucide-react';
import { fmtDate } from '@/lib/date';
import { formatStaffName, nameForEmail } from '@/lib/staff-directory';
import type { Company360 } from '@/lib/company-360';

// Colocated, route-scoped presentational pieces for Company 360 — every
// one of these is read-only, so all stay server components (no 'use
// client'), matching app/companies/[id]/page.tsx itself. Kept in one file
// since none of these are reused outside this route.

export function StatusBadge({ status }: { status: string | null }) {
  const normalized = (status ?? '').toLowerCase();
  const palette = normalized === 'active'
    ? { color: '#15803d', background: '#f0fdf4', border: '#bbf7d0' }
    : /strik/.test(normalized)
      ? { color: '#dc2626', background: '#fef2f2', border: '#fecaca' }
      : /terminat/.test(normalized)
        ? { color: '#b45309', background: '#fff7ed', border: '#fed7aa' }
        : { color: '#64748b', background: '#f8fafc', border: '#e2e8f0' };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 999, background: '#fff', color: palette.color, border: '1px solid #dbe3ec', fontSize: 10.5, fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap' }}>
      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: palette.color, flexShrink: 0 }} />
      {status || 'Pending Sync'}
    </span>
  );
}

// Flags a row found by fuzzy company-name matching rather than a real
// company_id/UEN link — see lib/company-360.ts's own module comment for why
// most of these tables have no reliable FK at all. Deliberately silent
// (returns null) for a 100/100 exact match — that's as confident as this
// gets, and showing a badge on every single row (the common case) would be
// noise, not signal; Vincent flagged exactly this ("看不懂，用户可能也不理解")
// when every QuickBooks row showed "Paid~100"/"Open~100" concatenated right
// onto the status text with no separation. Only a genuinely uncertain match
// (score < 100) is worth a staff member's attention.
function MatchBadge({ via }: { via: 'company_id' | 'uen' | 'fuzzy' | number }) {
  const pillStyle = { display: 'inline-flex', alignItems: 'center', marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 999, padding: '1px 6px', whiteSpace: 'nowrap' as const };
  if (typeof via === 'number') {
    if (via >= 100) return null;
    return <span title={`Matched by company name only, not an exact match — ${via}/100 confidence. Verify this is really the right company before relying on it.`} style={pillStyle}>{via}% match</span>;
  }
  if (via === 'fuzzy') return <span title="Matched by company name only, not a company ID/UEN — verify this is really the right company." style={pillStyle}>name match only</span>;
  return null;
}

export function DataCard({ title, icon, count, empty, children, scrollable = true }: {
  title: string; icon: React.ReactNode; count: number; empty: string; children?: React.ReactNode;
  // 2026-09-03, Vincent on Officials specifically ("这一块不需要限制长度有多
  // 少显示多少") — the 360px internal scroll every other section here still
  // uses is fine for occasional overflow, but Officials can genuinely run to
  // 8+ real rows (every appointed role, one row each) and forcing that into
  // a little scrollbox made it harder to read than just letting the card
  // grow and the page itself scroll. Opt-in per section, not a global
  // change to every DataCard.
  scrollable?: boolean;
}) {
  return (
    <div className="system-list-shell" style={{ marginBottom: 16 }}>
      <div className="system-list-title-bar px-4 py-3" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <h2 className="system-list-title">{title}</h2>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{count}</span>
      </div>
      {count === 0 ? (
        <div style={{ padding: '24px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{empty}</div>
      ) : scrollable ? (
        <div className="system-list-scroll" style={{ maxHeight: 360 }}>
          {children}
        </div>
      ) : (
        <div className="system-list-scroll" style={{ overflow: 'visible' }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MatchQualityNote({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 14px', borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', marginBottom: 16, fontSize: 11.5, color: '#92400e' }}>
      <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
      <ul style={{ margin: 0, paddingLeft: 16 }}>
        {warnings.map((w, i) => <li key={i}>{w}</li>)}
      </ul>
    </div>
  );
}

// Shared with CommsSection below — must be the exact same formula as the
// header card's own field grid in page.tsx (repeat(5, minmax(0,1fr)),
// gap: 16) for the two to align (2026-09-04, Vincent: "上下没有对齐，第2和
// 第3模块要和 第1模块对齐"). An HTML <table>'s colgroup percentages can
// never exactly reproduce a CSS grid's gap-based column math (a table has
// no native concept of a gap between columns, only per-cell padding), so
// this replaced the previous <table> markup with the same div/grid row
// pattern MasterListTable.tsx already uses elsewhere in this codebase —
// not a new technique, just applied here for the first time on this page.
const CARD_GRID_COLS = 'repeat(5, minmax(0,1fr))';

export function ArAgmSection({ cycles }: { cycles: Company360['arReminderCycles'] }) {
  return (
    <DataCard title="AR / AGM Cycles" icon={<Calendar size={15} color="#fff" />} count={cycles.length} empty="No AR/AGM cycles on file for this company.">
      {/* FYE and PIC columns dropped (2026-09-04, Vincent: "FYE 和 PIC 这两个
          不需要在（AR / AGM Cycles）显示" — both already shown in the header
          card above). The match badge (no header label) sits inline at the
          end of the Remarks cell instead of being its own 6th grid column —
          a 6th column would shrink the other 5 relative to the header's own
          5-column grid and reintroduce the same misalignment this was meant
          to fix. */}
      <div className="list-column-header-gray" style={{ display: 'grid', gridTemplateColumns: CARD_GRID_COLS, gap: 16, padding: '10px 16px' }}>
        <div>Due Date</div><div>Filed</div><div>ACC PIC</div><div>TAX PIC</div><div>Remarks</div>
      </div>
      {cycles.map(c => {
        const filed = !!c.filling_date;
        const overdue = !filed && c.daysUntilDue !== null && c.daysUntilDue < 0;
        return (
          <div key={c.id as number} className="system-list-row" style={{ display: 'grid', gridTemplateColumns: CARD_GRID_COLS, gap: 16, padding: '10px 16px', alignItems: 'center' }}>
            <div>
              {fmtDate(c.due_date as string)}
              {overdue && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: '#dc2626' }}>{Math.abs(c.daysUntilDue as number)}d overdue</span>}
            </div>
            <div>{filed ? fmtDate(c.filling_date as string) : <span style={{ color: '#cbd5e1' }}>—</span>}</div>
            <div style={{ fontSize: 11 }}>{formatStaffName(c.acc_pic as string) || '—'}</div>
            <div style={{ fontSize: 11 }}>{formatStaffName(c.tax_pic as string) || '—'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.remarks as string ?? ''}>{(c.remarks as string) || '—'}</span>
              <MatchBadge via={c.matchedVia} />
            </div>
          </div>
        );
      })}
    </DataCard>
  );
}

export function InvoicesSection({ invoices }: { invoices: Company360['invoices'] }) {
  const total = invoices.generated.length + invoices.quickbooks.length;
  return (
    <DataCard title="Invoices" icon={<FileText size={15} color="#fff" />} count={total} empty="No invoice history found for this company.">
      {invoices.generated.length > 0 && (
        <table className="system-list-table" style={{ width: '100%' }}>
          {/* Percentage colgroup, not fixed pixels — a fixed-px sum well
              under the container's real width left everything crowded on
              the left with a huge dead gap on the right (Vincent: "有点太
              挤了，全部都堆在了左边"). The first 4 columns here (Invoice No/
              Company/date-ish/Amount) use the EXACT SAME percentages as
              the QuickBooks table below, so the two stacked tables' column
              boundaries line up as one grid despite being separate
              <table> elements — same fix as the original alignment pass,
              just redone in % so it also survives different total column
              counts without one table's flex column ballooning. */}
          <colgroup>
            <col style={{ width: '16%' }} /><col style={{ width: '10%' }} /><col style={{ width: '14%' }} />
            <col style={{ width: '13%' }} /><col style={{ width: '22%' }} /><col style={{ width: '25%' }} />
          </colgroup>
          {/* 2026-09-02: this table used to be titled "Generated by this
              system" for every row, which overclaimed for the ~845
              historical rows bulk-imported to seed real QuickBooks history
              before this app's own invoice-generation feature went live
              (2026-07-17, confirmed live: created_by_email/idempotency_key
              are null on every one of those, non-null on every row created
              since) — Vincent asked directly why a 2024 invoice showed up
              here ("为什么会有在2024年在系统的开单记录"). The Source column
              below now tells the two apart per row instead of one header
              claiming credit for both. */}
          <thead><tr className="list-column-header-gray"><th colSpan={6} style={{ fontWeight: 700 }}>This system&apos;s invoice records</th></tr>
            <tr className="list-column-header-gray"><th>Invoice No.</th><th>Company</th><th>Cycle</th><th>Amount</th><th>Source</th><th>Created</th></tr>
          </thead>
          <tbody>
            {invoices.generated.map((r, i) => {
              const createdByEmail = r.created_by_email as string | null;
              return (
                <tr key={i} className="system-list-row">
                  <td style={{ padding: '6px 10px' }}>{r.invoice_no as string}</td>
                  <td style={{ padding: '6px 10px' }}>{r.qb_company as string}</td>
                  <td style={{ padding: '6px 10px' }}>{(r.fye_cycle as string) || '—'}</td>
                  <td style={{ padding: '6px 10px', fontVariantNumeric: 'tabular-nums' }}>{r.total_amt != null ? `$${(r.total_amt as number).toFixed(2)}` : '—'}</td>
                  <td style={{ padding: '6px 10px' }}>
                    {createdByEmail ? (
                      <span title={`Generated through this system by ${createdByEmail}`} style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 700, color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                        {nameForEmail(createdByEmail) ?? createdByEmail}
                      </span>
                    ) : (
                      <span title="Imported from real QuickBooks history to seed this company's record before this system's own invoice-generation feature existed — not generated by clicking through this app." style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 700, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                        Imported (historical)
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '6px 10px' }}>{fmtDate(r.created_at as string)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {invoices.quickbooks.length > 0 && (
        <table className="system-list-table" style={{ width: '100%' }}>
          <colgroup>
            <col style={{ width: '16%' }} /><col style={{ width: '10%' }} /><col style={{ width: '14%' }} />
            <col style={{ width: '13%' }} /><col style={{ width: '15%' }} /><col style={{ width: '32%' }} />
          </colgroup>
          <thead><tr className="list-column-header-gray"><th colSpan={6} style={{ fontWeight: 700 }}>QuickBooks history (matched by name)</th></tr>
            <tr className="list-column-header-gray"><th>Invoice No.</th><th>Company</th><th>Date</th><th>Amount</th><th>Balance</th><th>Status</th></tr>
          </thead>
          <tbody>
            {invoices.quickbooks.map((r, i) => (
              <tr key={i} className="system-list-row">
                <td style={{ padding: '6px 10px' }}>{r.invoice_no as string}</td>
                <td style={{ padding: '6px 10px' }}>{r.qb_company as string}</td>
                <td style={{ padding: '6px 10px' }}>{fmtDate(r.txn_date as string)}</td>
                <td style={{ padding: '6px 10px', fontVariantNumeric: 'tabular-nums' }}>{r.total_amt != null ? `$${(r.total_amt as number).toFixed(2)}` : '—'}</td>
                <td style={{ padding: '6px 10px', fontVariantNumeric: 'tabular-nums' }}>{r.balance != null ? `$${(r.balance as number).toFixed(2)}` : '—'}</td>
                <td style={{ padding: '6px 10px' }}>{r.status as string}<MatchBadge via={r.matchScore as number} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DataCard>
  );
}

export function NdSection({ nd }: { nd: Company360['nomineeDirector'] }) {
  return (
    <DataCard title="Nominee Director" icon={<Users size={15} color="#fff" />} count={nd.appointments.length} empty="No nominee director appointments on file.">
      <table className="system-list-table" style={{ width: '100%' }}>
        <colgroup>
          <col style={{ width: '30%' }} /><col style={{ width: '24%' }} /><col style={{ width: '16%' }} />
          <col style={{ width: '16%' }} /><col style={{ width: '14%' }} />
        </colgroup>
        <thead><tr className="list-column-header-gray"><th>Name</th><th>Sub-role</th><th>Appointed</th><th>Ceased</th><th>Status</th></tr></thead>
        <tbody>
          {nd.appointments.map((a, i) => (
            <tr key={i} className="system-list-row">
              <td style={{ padding: '6px 10px' }}>{a.ndName}</td>
              <td style={{ padding: '6px 10px' }}>{a.subRole || '—'}</td>
              <td style={{ padding: '6px 10px' }}>{fmtDate(a.appointmentDate)}</td>
              <td style={{ padding: '6px 10px' }}>{a.cessationDate ? fmtDate(a.cessationDate) : '—'}</td>
              <td style={{ padding: '6px 10px' }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: a.isActive ? '#15803d' : '#94a3b8' }}>{a.isActive ? 'Active' : 'Ceased'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataCard>
  );
}

export function CommsSection({ drafts }: { drafts: Company360['communications']['drafts'] }) {
  return (
    <DataCard title="Communications" icon={<Mail size={15} color="#fff" />} count={drafts.length} empty="No client communications sent to this company yet.">
      {/* Genuinely equal 5-way column split matching the header card's own
          grid (2026-09-04, Vincent: "分成5等分列宽和 第一模块的5等分列宽一致",
          then "上下没有对齐" once the first attempt — table colgroup
          percentages — still didn't line up against a CSS grid's gap-based
          math). Same div/grid pattern as ArAgmSection above; see
          CARD_GRID_COLS' own comment for why a <table> can't do this. */}
      <div className="list-column-header-gray" style={{ display: 'grid', gridTemplateColumns: CARD_GRID_COLS, gap: 16, padding: '10px 16px' }}>
        <div>Campaign</div><div>Subject</div><div>To</div><div>Status</div><div>Sent</div>
      </div>
      {drafts.map(d => {
        const campaign = d.email_campaigns as { name?: string; type?: string } | null;
        return (
          <div key={d.id as number} className="system-list-row" style={{ display: 'grid', gridTemplateColumns: CARD_GRID_COLS, gap: 16, padding: '10px 16px', alignItems: 'center' }}>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{campaign?.name || campaign?.type || '—'}</div>
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.subject as string ?? ''}>{(d.subject as string) || '—'}</div>
            <div style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(d.to_email as string) || '—'}</div>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: d.status === 'sent' ? '#15803d' : d.status === 'skipped' ? '#94a3b8' : '#b45309' }}>{d.status as string}</span>
            </div>
            <div>{d.sent_at ? fmtDate(d.sent_at as string) : '—'}</div>
          </div>
        );
      })}
    </DataCard>
  );
}

export function DocsGeneratedSection({ docs }: { docs: Company360['documentsGenerated'] }) {
  return (
    <DataCard title="Documents Generated" icon={<ScrollText size={15} color="#fff" />} count={docs.length} empty="No documents generated for this company through this system yet.">
      <table className="system-list-table" style={{ width: '100%' }}>
        <colgroup>
          <col style={{ width: '20%' }} /><col style={{ width: '15%' }} /><col style={{ width: '65%' }} />
        </colgroup>
        <thead><tr className="list-column-header-gray"><th>Generated</th><th>Files</th><th>Created by</th></tr></thead>
        <tbody>
          {docs.map((d, i) => (
            <tr key={i} className="system-list-row">
              <td style={{ padding: '6px 10px' }}>{fmtDate(d.created_at as string)}</td>
              <td style={{ padding: '6px 10px' }}>{((d.generated_files as string[] | null)?.length ?? 0)} file(s)</td>
              <td style={{ padding: '6px 10px' }}>{(d.created_by_name as string) || (d.created_by_email as string) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataCard>
  );
}

export function TrademarkSection({ trademark }: { trademark: Company360['trademark'] }) {
  return (
    <DataCard title="Trademark" icon={<Stamp size={15} color="#fff" />} count={trademark.length} empty="No trademark records found for this company.">
      <table className="system-list-table" style={{ width: '100%' }}>
        <colgroup>
          <col style={{ width: '26%' }} /><col style={{ width: '18%' }} /><col style={{ width: '18%' }} />
          <col style={{ width: '28%' }} /><col style={{ width: '10%' }} />
        </colgroup>
        <thead><tr className="list-column-header-gray"><th>Application No.</th><th>Filed</th><th>Expires</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {trademark.map((t, i) => (
            <tr key={i} className="system-list-row">
              <td style={{ padding: '6px 10px' }}>{(t.application_number as string) || '—'}</td>
              <td style={{ padding: '6px 10px' }}>{t.application_date ? fmtDate(t.application_date as string) : '—'}</td>
              <td style={{ padding: '6px 10px' }}>{t.mark_expired_date ? fmtDate(t.mark_expired_date as string) : '—'}</td>
              <td style={{ padding: '6px 10px', fontSize: 11 }}>{(t.status_text as string) || '—'}</td>
              <td style={{ padding: '6px 10px' }}><MatchBadge via={t.matchScore as number} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataCard>
  );
}

// Officials (Director/Secretary/Controller/Representative/Contact Person)
// and the real shareholder register — 2026-09-03, Vincent asked whether
// this was already captured from TeamWork ("我不确定你之前在读取TW的时候是否
// 都有记录"). It was: teamwork/sync-secretary has synced both nightly since
// before Company 360 existed, for Post Incorporate's own UEN lookup
// (app/api/post-incorporate/enrich/route.ts) — just never shown here.
// Matched by exact UEN (lib/company-360.ts), not fuzzy name matching, so no
// MatchBadge needed on these two.
export function OfficialsSection({ officials }: { officials: Company360['officials'] }) {
  return (
    <DataCard title="Officials" icon={<UserCog size={15} color="#fff" />} count={officials.length} empty="No officials on file from TeamWork for this company." scrollable={false}>
      <table className="system-list-table" style={{ width: '100%' }}>
        <colgroup>
          <col style={{ width: '22%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} />
          <col style={{ width: '14%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} />
        </colgroup>
        <thead><tr className="list-column-header-gray"><th>Name</th><th>Role</th><th>Sub-role(s)</th><th>Appointed</th><th>ID No.</th><th>Contact</th></tr></thead>
        <tbody>
          {officials.map((o, i) => (
            <tr key={i} className="system-list-row">
              <td style={{ padding: '6px 10px' }}>{(o.name as string) || '—'}</td>
              <td style={{ padding: '6px 10px' }}>{(o.role as string) || '—'}</td>
              <td style={{ padding: '6px 10px', fontSize: 11 }}>{(o.sub_roles as string) || '—'}</td>
              <td style={{ padding: '6px 10px' }}>{o.date_of_appointment ? fmtDate(o.date_of_appointment as string) : '—'}</td>
              <td style={{ padding: '6px 10px', fontSize: 11 }}>{(o.id_no as string) || '—'}</td>
              <td style={{ padding: '6px 10px', fontSize: 11 }}>{(o.email as string) || (o.mobile as string) || (o.telephone as string) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataCard>
  );
}

export function ShareholdersSection({ shareholders }: { shareholders: Company360['shareholders'] }) {
  return (
    <DataCard title="Shareholders" icon={<PieChart size={15} color="#fff" />} count={shareholders.length} empty="No shareholder share register on file from TeamWork for this company.">
      <table className="system-list-table" style={{ width: '100%' }}>
        <colgroup>
          <col style={{ width: '26%' }} /><col style={{ width: '14%' }} /><col style={{ width: '18%' }} />
          <col style={{ width: '10%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} />
        </colgroup>
        <thead><tr className="list-column-header-gray"><th>Shareholder</th><th>Shares</th><th>Paid-up Capital</th><th>Currency</th><th>Share Type / Class</th><th>Certificate No.</th></tr></thead>
        <tbody>
          {shareholders.map((s, i) => (
            <tr key={i} className="system-list-row">
              <td style={{ padding: '6px 10px' }}>{(s.shareholder_name as string) || '—'}</td>
              <td style={{ padding: '6px 10px' }}>{(s.number_of_shares as string) || '—'}</td>
              <td style={{ padding: '6px 10px' }}>{(s.paid_up_capital as string) || '—'}</td>
              <td style={{ padding: '6px 10px', fontSize: 11 }}>{(s.currency as string) || '—'}</td>
              <td style={{ padding: '6px 10px', fontSize: 11 }}>{[s.share_type, s.share_class].filter(Boolean).join(' / ') || '—'}</td>
              <td style={{ padding: '6px 10px', fontSize: 11 }}>{(s.share_certificate_no as string) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataCard>
  );
}
