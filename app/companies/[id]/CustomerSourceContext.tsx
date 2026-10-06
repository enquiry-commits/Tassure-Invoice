'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

// Shares the live Customer Source value between CustomerSourceField (which
// edits it) and RelationshipFields (whose "Referred By" is only editable when
// the source is "referral") — both sit in Company 360's header card, which is
// server-rendered, so a small client context carries the value between them.
type Ctx = { source: string | null; setSource: (v: string | null) => void };
const CustomerSourceCtx = createContext<Ctx>({ source: null, setSource: () => undefined });

export function CustomerSourceProvider({ initialValue, children }: { initialValue: string | null; children: ReactNode }) {
  const [source, setSource] = useState<string | null>(initialValue);
  return <CustomerSourceCtx.Provider value={{ source, setSource }}>{children}</CustomerSourceCtx.Provider>;
}

export function useCustomerSource() {
  return useContext(CustomerSourceCtx);
}
