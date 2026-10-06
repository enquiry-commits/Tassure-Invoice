// The app's navigation tree — ONE copy, shared by the desktop Sidebar and the
// phone MobileNav (which used to keep its own hand-written, already-drifted
// link list that ignored every access rule). Every account's menu is this
// tree filtered through lib/workspaces.ts's canSubjectOpen(); a group with no
// visible child disappears. Pure data (icons by name) so the guard tests can
// read it too.
//
// History kept from the old Sidebar.tsx comments:
// - Outstanding (Vincent, 2026-09-07): "把 SOA 放成一个单独的2级标题,然后把
//   TAB/TAC/TAO分成3个不同的3级标题" — its own level-2 group, one page per
//   QuickBooks book; "All" added on top the same day. Routes and internal
//   names stay /billing/soa/... — "Outstanding" is display text only.
// - Quotation (2026-09-24): a level-2 leaf, first right below Billing Drafts;
//   moved right ABOVE it 2026-10-04 (Vincent: "quotation 之后才到 Billing
//   Drafts" — a quotation comes before the invoice).
// - SG Latest News (2026-09-23) sits directly below My Tasks, Reports below it.
// - Turnover AI (2026-09-28): one level-1 leaf, everything on one page.
// - Admin (Vincent-only governance tools) stays the last level-1 item.
// - Proposal Generator is a separate Vercel app reached through an SSO
//   handoff route, so it opens in a new tab.

export type NavIcon = 'list-checks' | 'newspaper' | 'bar-chart' | 'scan-line' | 'shield-check';
export type NavNode = { label: string; href?: string; img?: string; icon?: NavIcon; external?: boolean; id?: string; children?: NavNode[] };

export const NAV_TREE: NavNode[] = [
  { label: 'Dashboard', href: '/', img: '/nav/dashboard.png' },
  { label: 'My Tasks', href: '/my-tasks', icon: 'list-checks' },
  { label: 'SG Latest News', href: '/sg-news', icon: 'newspaper' },
  { label: 'Reports', href: '/reports', icon: 'bar-chart' },
  { label: 'Companies', href: '/companies', img: '/nav/companies.png' },
  {
    id: 'master-list', label: 'Master List', img: '/nav/master-list.png',
    children: [
      {
        id: 'active-clients', label: 'Active Clients',
        children: [
          { label: 'Active Client', href: '/master-list/active-clients' },
          { label: 'Ad-Hoc', href: '/master-list/ad-hoc' },
          { label: 'MAS', href: '/master-list/mas' },
        ],
      },
      {
        id: 'strike-off', label: 'Strike Off / Terminated',
        children: [
          { label: 'Strike Off', href: '/master-list/strike-off' },
          { label: 'Terminated Services', href: '/master-list/terminated' },
          { label: 'EOT', href: '/master-list/eot' },
          { label: 'Change Co Name', href: '/master-list/name-change' },
        ],
      },
      {
        id: 'trademark', label: 'Trademark',
        children: [
          { label: 'Master Records', href: '/master-list/trademark/master-records' },
          { label: 'In Progress', href: '/master-list/trademark/in-progress' },
        ],
      },
    ],
  },
  {
    id: 'billing', label: 'Billing System', img: '/nav/billing.png',
    children: [
      { label: 'AR Reminder', href: '/billing?tab=ar' },
      { label: 'Late Filing', href: '/late-filing' },
      { label: 'Quotation', href: '/billing/quotation' },
      {
        id: 'billing-drafts', label: 'Billing Drafts',
        children: [
          { label: 'TAB / TAC', href: '/billing?tab=billing' },
          { label: 'TAO', href: '/billing/tao' },
        ],
      },
      {
        id: 'soa', label: 'Outstanding',
        children: [
          { label: 'All', href: '/billing/soa/all' },
          { label: 'TAB', href: '/billing/soa/tab' },
          { label: 'TAC', href: '/billing/soa/tac' },
          { label: 'TAO', href: '/billing/soa/tao' },
        ],
      },
      // Which split invoices have their original attached in QuickBooks (INV-QB-037).
      // Under /billing/soa so the existing "outstanding" page rule covers it.
      { label: 'Invoice Originals', href: '/billing/soa/originals' },
      { label: 'Nominee Directors', href: '/nominee-directors' },
      { label: 'Address Service', href: '/address-service' },
      {
        id: 'client-communications', label: 'Email Status',
        children: [
          { label: 'Email Drafts', href: '/client-communications/campaigns' },
          { label: 'History', href: '/client-communications/history' },
        ],
      },
    ],
  },
  { label: 'Post Incorporate', href: '/post-incorporate', img: '/nav/post-incorporate.png' },
  { label: 'Proposal Generator', href: '/sso/proposal-generator', img: '/nav/proposal-generator.png', external: true },
  { label: 'Turnover AI', href: '/turnover-ai', icon: 'scan-line' },
  {
    id: 'admin', label: 'Admin', icon: 'shield-check',
    children: [
      { label: 'Appearance Settings', href: '/admin/appearance' },
      { label: 'AI Learning', href: '/ai-learning' },
      { label: 'AI Quality', href: '/ai-quality' },
      { label: 'AI Usage', href: '/ai-usage' },
      { label: 'Activity Insights', href: '/activity-insights' },
    ],
  },
];

export function filterNav(nodes: readonly NavNode[], canOpen: (href: string) => boolean): NavNode[] {
  return nodes.flatMap(node => {
    if (node.children) {
      const children = filterNav(node.children, canOpen);
      return children.length ? [{ ...node, children }] : [];
    }
    return node.href && canOpen(node.href) ? [node] : [];
  });
}

export const navGroupIds = (nodes: readonly NavNode[]): string[] =>
  nodes.flatMap(n => (n.children ? [n.id!, ...navGroupIds(n.children)] : []));

/** Every leaf with the labels of the groups above it (outermost first). */
export function navLeaves(nodes: readonly NavNode[], trail: string[] = []): { node: NavNode; trail: string[] }[] {
  return nodes.flatMap(n => (n.children ? navLeaves(n.children, [...trail, n.label]) : [{ node: n, trail }]));
}
