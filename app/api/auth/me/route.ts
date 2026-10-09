import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getApprovedAccount } from '@/lib/approved-accounts';
import { WORKSPACES, switchableWorkspaces, resolveViewWorkspace, VIEW_WORKSPACE_COOKIE } from '@/lib/workspaces';

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => undefined },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return NextResponse.json({ user: null }, { status: 401 });
  const account = getApprovedAccount(data.user.email);
  if (!account) return NextResponse.json({ user: null }, { status: 403 });

  return NextResponse.json({
    user: {
      email: account.email,
      name: account.name,
      // The department this account belongs to (lib/workspaces.ts) — the
      // client menu runs the same canSubjectOpen() rule proxy.ts enforces.
      workspace: account.workspace,
      // The 切换部门 preview, validated here: only honoured for an account
      // that may switch, and only to a department it may preview. Display
      // only — nothing server-side reads this cookie as a permission.
      viewWorkspace: resolveViewWorkspace(account, cookieStore.get(VIEW_WORKSPACE_COOKIE)?.value),
      switchableWorkspaces: switchableWorkspaces(account).map(id => ({ id, title: WORKSPACES[id].title })),
      admin: account.admin ?? false,
      canViewReports: account.canViewReports ?? false,
      canViewActivityInsights: account.canViewActivityInsights ?? false,
      canViewSgNews: account.canViewSgNews ?? false,
      canViewQuotation: account.canViewQuotation ?? false,
      canViewTurnoverAI: account.canViewTurnoverAI ?? false,
      canViewAiUsage: account.canViewAiUsage ?? false,
      canViewOriginals: account.canViewOriginals ?? false,
    },
  });
}
