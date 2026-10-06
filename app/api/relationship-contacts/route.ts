import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { createExternalContact, ensureInternalContacts, listContacts } from '@/lib/relationship-contacts';

// Picker data for Company 360's "Referred by" / "RM" fields (see
// lib/relationship-contacts.ts). GET mirrors the staff directory into the
// table first, so a staff member added to lib/staff-directory.ts shows up
// here without a separate sync step.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  try {
    const supabase = createAdminClient();
    await ensureInternalContacts(supabase);
    return NextResponse.json({ contacts: await listContacts(supabase) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// Adds an external partner/introducer. Name is title-cased and de-duplicated
// server-side; an existing name just returns the existing row.
export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { name } = await req.json();
  if (typeof name !== 'string' || !name.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 });
  if (name.trim().length > 80) return NextResponse.json({ error: 'name too long' }, { status: 400 });

  try {
    const contact = await createExternalContact(createAdminClient(), name, account.email ?? null);
    return NextResponse.json({ contact });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
