/**
 * Single source of truth for every color/font token the Appearance Settings
 * editor (app/admin/appearance/page.tsx) can change. The DB table
 * (app_theme_tokens) is a sparse key→value override store — it only ever
 * holds keys listed here (enforced by the API route), and any key missing
 * from the table falls back to `default` below, which matches today's
 * hardcoded look exactly. Adding a token later means adding an entry here,
 * no migration needed.
 *
 * `scope` is verified, not guessed — checked against real `var(--x)`/literal
 * usages across app/ and components/ before writing it. `live: false` means
 * exactly what it says: changing that token has NO visible effect anywhere
 * yet (the real color is still a hardcoded literal in a page file not yet
 * migrated) — kept in the list so the palette can be planned ahead of that
 * migration, but never claimed as working when it isn't.
 */
export type ThemeTokenType = 'color' | 'font';

export interface ThemeTokenDef {
  key: string;
  cssVar: string;
  label: string;
  group: string;
  type: ThemeTokenType;
  default: string;
  live: boolean;
  scope: string;
}

export const THEME_TOKENS: ThemeTokenDef[] = [
  // Brand & structure
  { key: 'sidebar-bg', cssVar: '--sidebar-bg', label: '侧边栏背景', group: '品牌与结构', type: 'color', default: '#1e3a5f', live: true,
    scope: '全站所有页面（左侧导航栏是全局组件）' },
  { key: 'sidebar-hover', cssVar: '--sidebar-hover', label: '侧边栏悬停', group: '品牌与结构', type: 'color', default: '#2a5080', live: true,
    scope: '全站所有页面 —— 鼠标悬停在侧边栏菜单项上时的背景色' },
  { key: 'sidebar-active', cssVar: '--sidebar-active', label: '侧边栏选中项', group: '品牌与结构', type: 'color', default: '#2563eb', live: true,
    scope: '全站所有页面 —— 当前所在页面对应的菜单项背景色' },
  { key: 'header-bg', cssVar: '--header-bg', label: '顶部导航背景', group: '品牌与结构', type: 'color', default: '#ffffff', live: true,
    scope: '全站所有页面（顶部导航栏是全局组件）' },
  { key: 'card-header-bg', cssVar: '--card-header-bg', label: '卡片标题背景', group: '品牌与结构', type: 'color', default: '#1e3a8a', live: false,
    scope: '尚未接入 —— 系统里目前没有对应的界面元素在用这个颜色，改了不会有效果' },
  { key: 'company-name-color', cssVar: '--company-name-color', label: '公司名称文字', group: '品牌与结构', type: 'color', default: '#1e3a5f', live: true,
    scope: 'Dashboard、Companies、Billing Drafts、AR Reminder、Late Filing、Master List（全部分类）、Address Service、Nominee Directors、Client Communications —— 所有显示公司名称的地方' },

  // Text
  { key: 'text-secondary', cssVar: '--text-secondary', label: '次要文字', group: '文字', type: 'color', default: '#64748b', live: false,
    scope: '尚未接入 —— 预留给后续把页面里写死的同色号文字迁移进来' },
  { key: 'text-muted', cssVar: '--text-muted', label: '弱化文字', group: '文字', type: 'color', default: '#94a3b8', live: true,
    scope: '同「公司名称文字」覆盖的所有页面 —— 公司注册号等次要说明文字' },
  { key: 'list-text', cssVar: '--list-text', label: '表格正文文字', group: '文字', type: 'color', default: '#475569', live: true,
    scope: 'Billing Drafts、AR Reminder、Master List（全部分类）、Address Service、Late Filing、Companies、Client Communications（Email Drafts / History）、Dashboard —— 所有表格/列表页面的正文文字' },
  { key: 'list-muted', cssVar: '--list-muted', label: '表格弱化文字', group: '文字', type: 'color', default: '#8a9aad', live: true,
    scope: '同「表格正文文字」覆盖的所有页面 —— 表格里的编号等次要文字' },

  // Surfaces & borders
  { key: 'surface', cssVar: '--surface', label: '卡片 / 面板背景', group: '背景与边框', type: 'color', default: '#ffffff', live: false,
    scope: '尚未接入 —— 预留给后续迁移' },
  { key: 'surface-page', cssVar: '--surface-page', label: '页面背景', group: '背景与边框', type: 'color', default: '#f1f5f9', live: true,
    scope: '全站所有页面的统一底色' },
  { key: 'surface-subtle', cssVar: '--surface-subtle', label: '浅色背景', group: '背景与边框', type: 'color', default: '#f8fafc', live: false,
    scope: '尚未接入 —— 预留给后续迁移' },
  { key: 'border-default', cssVar: '--border-default', label: '默认边框', group: '背景与边框', type: 'color', default: '#e2e8f0', live: false,
    scope: '尚未接入 —— 预留给后续迁移' },
  { key: 'border-strong', cssVar: '--border-strong', label: '加粗边框', group: '背景与边框', type: 'color', default: '#cbd5e1', live: false,
    scope: '尚未接入 —— 预留给后续迁移' },
  { key: 'list-surface', cssVar: '--list-surface', label: '表格底色', group: '背景与边框', type: 'color', default: '#ffffff', live: true,
    scope: '同「表格正文文字」覆盖的所有表格/列表页面' },

  // List & table chrome
  { key: 'list-header', cssVar: '--list-header', label: '表格标题栏', group: '列表与表格', type: 'color', default: '#203d5f', live: true,
    scope: '同「表格正文文字」覆盖的所有表格/列表页面 —— 表格顶部深色标题条' },
  { key: 'list-header-border', cssVar: '--list-header-border', label: '表格标题栏边框', group: '列表与表格', type: 'color', default: '#183451', live: true,
    scope: '同上 —— 标题条下边框' },
  { key: 'list-column-header-bg', cssVar: '--list-column-header-bg', label: '列标题背景', group: '列表与表格', type: 'color', default: '#e4e9ef', live: true,
    scope: 'Master List（全部分类）、Address Service —— 灰色列标题背景' },
  { key: 'list-column-header-text', cssVar: '--list-column-header-text', label: '列标题文字', group: '列表与表格', type: 'color', default: '#1e293b', live: true,
    scope: '同上 —— 列标题文字颜色' },
  { key: 'list-column-header-border', cssVar: '--list-column-header-border', label: '列标题边框', group: '列表与表格', type: 'color', default: '#d3dbe4', live: true,
    scope: '同上 —— 列标题下边框' },
  { key: 'list-border', cssVar: '--list-border', label: '表格行边框', group: '列表与表格', type: 'color', default: '#e3eaf1', live: true,
    scope: '同「表格正文文字」覆盖的所有表格/列表页面 —— 行与行之间的分隔线' },
  { key: 'list-row-hover', cssVar: '--list-row-hover', label: '行悬停背景', group: '列表与表格', type: 'color', default: '#f6f9fc', live: true,
    scope: '同上 —— 鼠标悬停某一行时的背景色' },
  { key: 'list-row-selected', cssVar: '--list-row-selected', label: '行选中背景', group: '列表与表格', type: 'color', default: '#edf4fa', live: true,
    scope: '同上 —— 选中/展开某一行时的背景色' },
  { key: 'list-scrollbar-thumb', cssVar: '--list-scrollbar-thumb', label: '表格滚动条', group: '列表与表格', type: 'color', default: '#c5d0dc', live: true,
    scope: 'Billing Drafts、AR Reminder、Address Service、Companies、Client Communications（Email Drafts / History）—— 表格区域的滚动条颜色' },
  { key: 'scrollbar-thumb', cssVar: '--scrollbar-thumb', label: '全站滚动条', group: '列表与表格', type: 'color', default: '#94a3b8', live: true,
    scope: '全站所有可滚动区域的默认滚动条颜色（没有专属表格滚动条颜色的地方都用这个）' },

  // Status
  { key: 'status-success', cssVar: '--status-success', label: '成功色', group: '状态颜色', type: 'color', default: '#16a34a', live: true,
    scope: 'Billing Drafts、AR Reminder —— 续费/已开单等"正常"状态的文字颜色' },
  { key: 'status-success-tint', cssVar: '--status-success-tint', label: '成功色（浅）', group: '状态颜色', type: 'color', default: '#f0fdf4', live: true,
    scope: '同上 —— 配套的浅色背景' },
  { key: 'status-warning', cssVar: '--status-warning', label: '警告色', group: '状态颜色', type: 'color', default: '#b45309', live: true,
    scope: 'Billing Drafts、AR Reminder —— 即将到期/待处理等提醒状态的文字颜色' },
  { key: 'status-warning-tint', cssVar: '--status-warning-tint', label: '警告色（浅）', group: '状态颜色', type: 'color', default: '#fff7ed', live: true,
    scope: '同上 —— 配套的浅色背景' },
  { key: 'status-danger', cssVar: '--status-danger', label: '危险色', group: '状态颜色', type: 'color', default: '#dc2626', live: true,
    scope: 'Billing Drafts、AR Reminder —— 过期/失败等状态的文字颜色' },
  { key: 'status-danger-tint', cssVar: '--status-danger-tint', label: '危险色（浅）', group: '状态颜色', type: 'color', default: '#fef2f2', live: true,
    scope: '同上 —— 配套的浅色背景' },
  { key: 'status-info-tint', cssVar: '--status-info-tint', label: '提示色（浅）', group: '状态颜色', type: 'color', default: '#eff6ff', live: true,
    scope: 'Billing Drafts —— Accounts 服务标签、TAB 标记等提示色的浅色背景' },
  { key: 'accent-blue', cssVar: '--accent-blue', label: '提示色 / 强调蓝', group: '状态颜色', type: 'color', default: '#1d4ed8', live: true,
    scope: 'Billing Drafts —— Accounts 服务标签、TAB 标记等提示色文字' },
  { key: 'accent-orange', cssVar: '--accent-orange', label: '强调橙', group: '状态颜色', type: 'color', default: '#f97316', live: false,
    scope: '尚未接入 —— 只接入了一个系统里还没启用的组件，暂时改了看不到效果' },
  { key: 'accent-yellow', cssVar: '--accent-yellow', label: '强调黄', group: '状态颜色', type: 'color', default: '#eab308', live: true,
    scope: 'Client Communications → Email Drafts 的模板/发件人管理页 —— "设为默认"的星标颜色' },
  { key: 'accent-gray', cssVar: '--accent-gray', label: '强调灰', group: '状态颜色', type: 'color', default: '#6b7280', live: true,
    scope: 'Billing Drafts —— 快捷菜单里一处次要按钮文字颜色' },
  { key: 'accent-red', cssVar: '--accent-red', label: '强调红', group: '状态颜色', type: 'color', default: '#ef4444', live: true,
    scope: 'Billing Drafts —— 快捷菜单里一处警示按钮文字颜色' },

  // Font
  { key: 'font-family', cssVar: '--font-family', label: '基础字体', group: '字体', type: 'font', default: 'system', live: true,
    scope: '全站所有页面的正文字体' },
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
  { key: 'system', label: '系统默认', cssValue: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { key: 'inter', label: 'Inter', cssValue: 'var(--font-inter)' },
  { key: 'lato', label: 'Lato', cssValue: 'var(--font-lato)' },
  { key: 'poppins', label: 'Poppins', cssValue: 'var(--font-poppins)' },
  { key: 'source-sans', label: 'Source Sans 3', cssValue: 'var(--font-source-sans)' },
  { key: 'work-sans', label: 'Work Sans', cssValue: 'var(--font-work-sans)' },
];

export function resolveFontValue(key: string): string {
  return FONT_OPTIONS.find(f => f.key === key)?.cssValue ?? FONT_OPTIONS[0].cssValue;
}
