'use client';

import { createContext, useContext } from 'react';
import { canSubjectOpenHref, type WorkspaceId } from '@/lib/workspaces';

// The signed-in account as /api/auth/me returns it, shared from AppShell so
// a page can tell which of its links this person can actually open (the same
// canSubjectOpen() rule proxy.ts enforces) instead of showing a link that
// just bounces them back to their department's home page.
export type SessionUser = {
  email: string;
  name: string;
  workspace: WorkspaceId;
  viewWorkspace: WorkspaceId;
  switchableWorkspaces: { id: WorkspaceId; title: string }[];
  admin: boolean;
  canViewReports: boolean;
  canViewActivityInsights: boolean;
  canViewSgNews: boolean;
  canViewQuotation: boolean;
  canViewTurnoverAI: boolean;
};

type Session = { user: SessionUser | null; canOpen: (href: string) => boolean };

// Before the user has loaded, links stay clickable (most accounts can open
// them, and proxy.ts still enforces the real rule) — only the menu itself
// waits, so nobody briefly sees pages outside their department.
export function canOpenFor(user: SessionUser | null, href: string): boolean {
  return !user || canSubjectOpenHref(user, href, user.viewWorkspace);
}

const SessionContext = createContext<Session>({ user: null, canOpen: () => true });

export const SessionProvider = SessionContext.Provider;
export const useSession = () => useContext(SessionContext);
