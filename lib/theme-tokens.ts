/**
 * Single source of truth for every color/font token the Appearance Settings
 * editor (app/admin/appearance/page.tsx) can change. The DB table
 * (app_theme_tokens) is a sparse key→value override store — it only ever
 * holds keys listed here (enforced by the API route), and any key missing
 * from the table falls back to `default` below, which matches today's
 * hardcoded look exactly. Adding a token later means adding an entry here,
 * no migration needed.
 */
export type ThemeTokenType = 'color' | 'font';

export interface ThemeTokenDef {
  key: string;
  cssVar: string;
  label: string;
  group: string;
  type: ThemeTokenType;
  default: string;
}

export const THEME_TOKENS: ThemeTokenDef[] = [
  // Brand & structure
  { key: 'sidebar-bg', cssVar: '--sidebar-bg', label: 'Sidebar background', group: 'Brand & Structure', type: 'color', default: '#1d3a5c' },
  { key: 'sidebar-hover', cssVar: '--sidebar-hover', label: 'Sidebar item hover', group: 'Brand & Structure', type: 'color', default: '#2a5080' },
  { key: 'sidebar-active', cssVar: '--sidebar-active', label: 'Sidebar active item', group: 'Brand & Structure', type: 'color', default: '#2563eb' },
  { key: 'header-bg', cssVar: '--header-bg', label: 'Top header background', group: 'Brand & Structure', type: 'color', default: '#ffffff' },
  { key: 'card-header-bg', cssVar: '--card-header-bg', label: 'Card header background', group: 'Brand & Structure', type: 'color', default: '#1e3a8a' },
  { key: 'company-name-color', cssVar: '--company-name-color', label: 'Company name text', group: 'Brand & Structure', type: 'color', default: '#1e3a5f' },

  // Text
  { key: 'text-secondary', cssVar: '--text-secondary', label: 'Secondary text', group: 'Text', type: 'color', default: '#64748b' },
  { key: 'text-muted', cssVar: '--text-muted', label: 'Muted text', group: 'Text', type: 'color', default: '#94a3b8' },
  { key: 'list-text', cssVar: '--list-text', label: 'Table body text', group: 'Text', type: 'color', default: '#475569' },
  { key: 'list-muted', cssVar: '--list-muted', label: 'Table muted text', group: 'Text', type: 'color', default: '#8a9aad' },

  // Surfaces & borders
  { key: 'surface', cssVar: '--surface', label: 'Card / panel background', group: 'Surfaces & Borders', type: 'color', default: '#ffffff' },
  { key: 'surface-page', cssVar: '--surface-page', label: 'Page background', group: 'Surfaces & Borders', type: 'color', default: '#f1f5f9' },
  { key: 'surface-subtle', cssVar: '--surface-subtle', label: 'Subtle background', group: 'Surfaces & Borders', type: 'color', default: '#f8fafc' },
  { key: 'border-default', cssVar: '--border-default', label: 'Default border', group: 'Surfaces & Borders', type: 'color', default: '#e2e8f0' },
  { key: 'border-strong', cssVar: '--border-strong', label: 'Strong border', group: 'Surfaces & Borders', type: 'color', default: '#cbd5e1' },
  { key: 'list-surface', cssVar: '--list-surface', label: 'Table surface', group: 'Surfaces & Borders', type: 'color', default: '#ffffff' },

  // List & table chrome
  { key: 'list-header', cssVar: '--list-header', label: 'Table title bar', group: 'List & Table', type: 'color', default: '#203d5f' },
  { key: 'list-header-border', cssVar: '--list-header-border', label: 'Table title bar border', group: 'List & Table', type: 'color', default: '#183451' },
  { key: 'list-column-header-bg', cssVar: '--list-column-header-bg', label: 'Column header background', group: 'List & Table', type: 'color', default: '#e4e9ef' },
  { key: 'list-column-header-text', cssVar: '--list-column-header-text', label: 'Column header text', group: 'List & Table', type: 'color', default: '#1e293b' },
  { key: 'list-column-header-border', cssVar: '--list-column-header-border', label: 'Column header border', group: 'List & Table', type: 'color', default: '#d3dbe4' },
  { key: 'list-border', cssVar: '--list-border', label: 'Table row border', group: 'List & Table', type: 'color', default: '#e3eaf1' },
  { key: 'list-row-hover', cssVar: '--list-row-hover', label: 'Row hover background', group: 'List & Table', type: 'color', default: '#f6f9fc' },
  { key: 'list-row-selected', cssVar: '--list-row-selected', label: 'Row selected background', group: 'List & Table', type: 'color', default: '#edf4fa' },

  // Status
  { key: 'status-success', cssVar: '--status-success', label: 'Success', group: 'Status', type: 'color', default: '#16a34a' },
  { key: 'status-success-tint', cssVar: '--status-success-tint', label: 'Success (tint)', group: 'Status', type: 'color', default: '#f0fdf4' },
  { key: 'status-warning', cssVar: '--status-warning', label: 'Warning', group: 'Status', type: 'color', default: '#b45309' },
  { key: 'status-warning-tint', cssVar: '--status-warning-tint', label: 'Warning (tint)', group: 'Status', type: 'color', default: '#fff7ed' },
  { key: 'status-danger', cssVar: '--status-danger', label: 'Danger', group: 'Status', type: 'color', default: '#dc2626' },
  { key: 'status-danger-tint', cssVar: '--status-danger-tint', label: 'Danger (tint)', group: 'Status', type: 'color', default: '#fef2f2' },
  { key: 'status-info-tint', cssVar: '--status-info-tint', label: 'Info (tint)', group: 'Status', type: 'color', default: '#eff6ff' },
  { key: 'accent-blue', cssVar: '--accent-blue', label: 'Info / accent blue', group: 'Status', type: 'color', default: '#1d4ed8' },
  { key: 'accent-orange', cssVar: '--accent-orange', label: 'Accent orange', group: 'Status', type: 'color', default: '#f97316' },
  { key: 'accent-yellow', cssVar: '--accent-yellow', label: 'Accent yellow', group: 'Status', type: 'color', default: '#eab308' },
  { key: 'accent-gray', cssVar: '--accent-gray', label: 'Accent gray', group: 'Status', type: 'color', default: '#6b7280' },
  { key: 'accent-red', cssVar: '--accent-red', label: 'Accent red', group: 'Status', type: 'color', default: '#ef4444' },

  // Font
  { key: 'font-family', cssVar: '--font-family', label: 'Base font', group: 'Font', type: 'font', default: 'system' },
];

export const THEME_TOKEN_KEYS = new Set(THEME_TOKENS.map(t => t.key));

export interface FontOption {
  key: string;
  label: string;
  cssValue: string;
}

// cssValue references the CSS var each next/font/google face is bound to on
// <body> in app/layout.tsx (variable: '--font-inter', etc.) — self-hosted,
// no runtime fetch. "System Default" needs no font loaded at all.
export const FONT_OPTIONS: FontOption[] = [
  { key: 'system', label: 'System Default', cssValue: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { key: 'inter', label: 'Inter', cssValue: 'var(--font-inter)' },
  { key: 'lato', label: 'Lato', cssValue: 'var(--font-lato)' },
  { key: 'poppins', label: 'Poppins', cssValue: 'var(--font-poppins)' },
  { key: 'source-sans', label: 'Source Sans 3', cssValue: 'var(--font-source-sans)' },
  { key: 'work-sans', label: 'Work Sans', cssValue: 'var(--font-work-sans)' },
];

export function resolveFontValue(key: string): string {
  return FONT_OPTIONS.find(f => f.key === key)?.cssValue ?? FONT_OPTIONS[0].cssValue;
}
