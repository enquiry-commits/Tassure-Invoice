import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Building2 } from 'lucide-react';
import { createAdminClient } from '@/lib/supabase';
import { getCompany360 } from '@/lib/company-360';
import { formatStaffName } from '@/lib/staff-directory';
import CopyUenButton from './CopyUenButton';
import CustomerSourceField from './CustomerSourceField';
import {
  StatusBadge, MatchQualityNote,
  ArAgmSection, InvoicesSection, NdSection, CommsSection, TrademarkSection,
  OfficialsSection, ShareholdersSection,
} from './_components';

// Company 360 — the first page-level dynamic route and the first true
// server-rendered data page in this app (every other page is 'use client'
// + useEffect fetch — see PROJECT_STATUS.md's 2026-08-31 entry for why
// this is a deliberate departure, not an accident). Everything about this
// company lives on one page instead of scattered across 7+ separate
// pages with no single "look up this company" view.
//
// preferredRegion added 2026-09-02: Vincent reported this page felt slow
// to open. Unlike this app's normal pages, this one issues ~11 Supabase
// queries (lib/company-360.ts) before it can render anything at all — with
// no region pinned, Vercel runs the function in its default region while
// Supabase is Tokyo-hosted, so every one of those round-trips was crossing
// the Pacific. Matches the same 'sin1' pin already used by every
// TeamWork-scraping cron route in this codebase (those pin for latency to
// TeamWork's own Singapore servers; this pins for latency to Supabase).
export const preferredRegion = 'sin1';

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const data = await getCompany360(createAdminClient(), id);
  if (!data) notFound();

  const { company, masterList } = data;
  const ml = masterList[0] as Record<string, unknown> | undefined;

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">
        <Link href="/companies" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'inherit', textDecoration: 'none' }}>
          <ArrowLeft size={12} />Companies
        </Link>
        {' › '}{company.companyName}
      </div>

      <MatchQualityNote warnings={data.matchQuality.warnings} />

      {/* Header card */}
      <div className="system-list-shell" style={{ marginBottom: 20 }}>
        <div className="system-list-title-bar px-4 py-3" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Building2 size={15} color="#fff" />
          <h2 className="system-list-title">{company.companyName}</h2>
        </div>
        {/* Three rows, Vincent's latest exact spec (2026-09-03): row 1
            UEN/Status/Client Type/Company Type/FYE, row 2 Secretary PIC/
            Contact/Customer Source/SSIC Primary/SSIC Secondary — both
            divided into 5 equal columns ("列宽等分5分，每一个的列宽一样宽"),
            row 3 Invoice Address alone, no column division needed. Row 1
            and row 2 both happen to have exactly 5 primary fields, so two
            separate `repeat(5,...)` grids share the same column boundaries
            by construction (same count, same width formula) without
            needing one merged grid + explicit line ranges the way the
            previous 8-vs-3 mismatch did. Row gap widened per Vincent's ask
            ("每一行的间距稍微拉长一点"). */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 16 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>UEN</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="company-registration-text">{company.registrationNo || '—'}</span>
                {company.registrationNo && <CopyUenButton uen={company.registrationNo} />}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>Status</div>
              <StatusBadge status={company.twStatus} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>Client Type</div>
              <div style={{ fontSize: 12 }}>{company.clientType || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>Company Type</div>
              <div style={{ fontSize: 12 }}>{company.companyType || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>FYE</div>
              <div style={{ fontSize: 12 }}>{company.fyeMonth || '—'}{company.fyeDay ? ` ${company.fyeDay}` : ''}</div>
            </div>
            {company.parentCompanyName && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>Parent Company</div>
                <div style={{ fontSize: 12 }}>{company.parentCompanyName}</div>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0,1fr))', gap: 16 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>Secretary PIC</div>
              <div style={{ fontSize: 12 }}>{formatStaffName(company.secPic ?? company.pic) || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>Contact</div>
              <div style={{ fontSize: 12 }}>{company.primaryContact?.contactName || company.bestEmail || '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>Customer Source</div>
              <CustomerSourceField companyId={company.id} initialValue={company.customerSource} />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>SSIC (Primary)</div>
              <div style={{ fontSize: 12 }}>{company.ssicCode1 ? `${company.ssicCode1} — ${company.ssicDescription1 || '—'}` : '—'}</div>
            </div>
            {company.ssicCode2 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>SSIC (Secondary)</div>
                <div style={{ fontSize: 12 }}>{`${company.ssicCode2} — ${company.ssicDescription2 || '—'}`}</div>
              </div>
            )}
            {ml?.tel != null && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>Tel</div>
                <div style={{ fontSize: 12 }}>{(ml.tel as string) || '—'}</div>
              </div>
            )}
          </div>

          {ml?.invoice_address != null && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>Invoice Address</div>
              <div style={{ fontSize: 12 }}>{(ml.invoice_address as string) || '—'}</div>
            </div>
          )}
        </div>
      </div>

      <OfficialsSection officials={data.officials} />
      <ShareholdersSection shareholders={data.shareholders} />
      <ArAgmSection cycles={data.arReminderCycles} />
      <InvoicesSection invoices={data.invoices} />
      <NdSection nd={data.nomineeDirector} />
      <CommsSection drafts={data.communications.drafts} />
      {/* Documents Generated section removed 2026-09-03 (Vincent: "这个不需
          要") — Post Incorporate document generation is still early (only
          1 of 13 planned templates live), so this showed an empty state
          for nearly every company. The underlying data/component
          (getCompany360's documentsGenerated, DocsGeneratedSection in
          _components.tsx) are left in place, not deleted, in case this
          is worth bringing back once more document types exist. */}
      <TrademarkSection trademark={data.trademark} />
    </div>
  );
}
