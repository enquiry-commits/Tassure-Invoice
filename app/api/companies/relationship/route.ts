import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';

// Edits one of the three client-relationship columns from Company 360 (see
// scripts/add-relationship-contacts.sql, lib/relationship-contacts.ts).
// Plain top-level columns — a direct .update() like customer-source's route.
const COLUMN_BY_FIELD = {
  clientSince: 'client_since',
  referrerContactId: 'referrer_contact_id',
  rmContactId: 'rm_contact_id',
  clientSinceNote: 'client_since_note',
} as const;
type Field = keyof typeof COLUMN_BY_FIELD;

export async function PATCH(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { companyId, field, value } = await req.json();
  if (!companyId) return NextResponse.json({ error: 'companyId required' }, { status: 400 });
  if (!(field in COLUMN_BY_FIELD)) return NextResponse.json({ error: `field must be one of: ${Object.keys(COLUMN_BY_FIELD).join(', ')}` }, { status: 400 });

  let stored: string | number | null = null;
  if (value !== null && value !== '') {
    if (field === 'clientSinceNote') {
      if (typeof value !== 'string') return NextResponse.json({ error: 'clientSinceNote must be text or null' }, { status: 400 });
      const note = value.trim();
      if (note.length > 300) return NextResponse.json({ error: 'note too long (max 300 characters)' }, { status: 400 });
      stored = note || null;
    } else if (field === 'clientSince') {
      const ok = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
      if (!ok) return NextResponse.json({ error: 'clientSince must be a valid YYYY-MM-DD date' }, { status: 400 });
      stored = value;
    } else {
      if (!Number.isInteger(value) || value <= 0) return NextResponse.json({ error: `${field} must be a contact id or null` }, { status: 400 });
      stored = value;
    }
  }

  const supabase = createAdminClient();
  if (typeof stored === 'number') {
    const { data: contact } = await supabase.from('relationship_contacts').select('id').eq('id', stored).maybeSingle();
    if (!contact) return NextResponse.json({ error: 'Unknown contact' }, { status: 400 });
  }

  const { error } = await supabase.from('companies').update({ [COLUMN_BY_FIELD[field as Field]]: stored }).eq('id', companyId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, field, value: stored });
}
