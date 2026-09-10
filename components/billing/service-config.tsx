'use client';

// Extracted 2026-09-10 from app/billing/page.tsx so both that page and the
// chat assistant's Billing Drafts modal render the same service badges.
// Icons make this a UI constant, not a lib value — hence components/, not lib/.
import { ShieldCheck, MapPin, UserCheck, BarChart3, BookOpen, DollarSign, FileText } from 'lucide-react';

export const SVC_CONFIG = {
  Secretary: { label: 'Secretary',    short: 'SEC',  bg: '#f5f3ff', color: '#6d28d9', Icon: BookOpen   },
  Address:   { label: 'Reg. Address', short: 'ADDR', bg: 'var(--status-success-tint)', color: '#15803d', Icon: MapPin     },
  ND:        { label: 'Nominee Dir.', short: 'ND',   bg: '#dcfce7', color: '#166534', Icon: UserCheck  },
  AR:        { label: 'AR / AGM',     short: 'AR',   bg: 'var(--status-warning-tint)', color: '#c2410c', Icon: BarChart3  },
  XBRL:      { label: 'XBRL',         short: 'XBRL', bg: '#fdf4ff', color: '#7e22ce', Icon: ShieldCheck },
  Discount:  { label: 'Discount',     short: 'DISC', bg: 'var(--status-danger-tint)', color: 'var(--status-danger)', Icon: DollarSign },
  Accounts:  { label: 'Accounts',     short: 'ACCT', bg: 'var(--status-info-tint)', color: 'var(--accent-blue)', Icon: FileText   },
  Tax:       { label: 'Tax',          short: 'TAX',  bg: '#f0fdfa', color: '#0f766e', Icon: FileText   },
};
