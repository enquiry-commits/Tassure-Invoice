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
  ArAgmSection, InvoicesSection, NdSection, CommsSection, DocsGeneratedSection, TrademarkSection,
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
        {/* ONE 8-column grid for the whole card, not two separate grids
            (2026-09-03 — Vincent, after the fixed-column-count fix solved
            row 1's wrapping: "我觉得最重要的不是100%填满，而是上下对齐"). Two
            grids with different column counts (8 vs 3) never shared column
            boundaries — Invoice Address/SSIC's left edges landed wherever
            a 3-column split happened to fall, not under any particular
            row-1 field, even though row 1 itself no longer wrapped
            unevenly. A single shared `repeat(8,...)` template with explicit
            `gridColumn` line ranges on the second-row fields (rather than
            plain auto-placement) guarantees their column edges always
            align with row 1's, regardless of which optional fields
            (Parent Company/Tel/Invoice Address) do or don't render. */}
        <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0,1fr))', gap: 16 }}>
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
          {company.parentCompanyName && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>Parent Company</div>
              <div style={{ fontSize: 12 }}>{company.parentCompanyName}</div>
            </div>
          )}
          {ml?.tel != null && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>Tel</div>
              <div style={{ fontSize: 12 }}>{(ml.tel as string) || '—'}</div>
            </div>
          )}
          {ml?.invoice_address != null && (
            <div style={{ gridColumn: '1 / 4' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>Invoice Address</div>
              <div style={{ fontSize: 12 }}>{(ml.invoice_address as string) || '—'}</div>
            </div>
          )}
          <div style={{ gridColumn: '4 / 7' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>SSIC (Primary)</div>
            <div style={{ fontSize: 12 }}>{company.ssicCode1 ? `${company.ssicCode1} — ${company.ssicDescription1 || '—'}` : '—'}</div>
          </div>
          {company.ssicCode2 && (
            <div style={{ gridColumn: '7 / 9' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 }}>SSIC (Secondary)</div>
              <div style={{ fontSize: 12 }}>{`${company.ssicCode2} — ${company.ssicDescription2 || '—'}`}</div>
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
      <DocsGeneratedSection docs={data.documentsGenerated} />
      <TrademarkSection trademark={data.trademark} />
    </div>
  );
}
