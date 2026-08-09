import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { parseBizfilePdf } from '@/lib/bizfile-parse';
import { inferIdType } from '@/lib/teamwork-company-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

// "26 JUL 2016" -> "2016-07-26" (the <input type="date"> shape the form uses).
function toIsoDate(acraDate: string): string {
  const m = /^(\d{1,2})\s+([A-Z]{3})\s+(\d{4})$/.exec(acraDate.trim().toUpperCase());
  if (!m) return '';
  const month = MONTHS[m[2]];
  if (!month) return '';
  return `${m[3]}-${month}-${m[1].padStart(2, '0')}`;
}

export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || !(file instanceof File)) return NextResponse.json({ error: 'A PDF file is required (field name "file").' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed: Awaited<ReturnType<typeof parseBizfilePdf>>;
  try {
    parsed = await parseBizfilePdf(buffer);
  } catch (error) {
    console.error('Bizfile PDF parse failed:', error);
    return NextResponse.json({ error: 'Could not parse this PDF. Make sure it is a text-based ACRA Bizfile Business Profile export (not a scanned image).' }, { status: 422 });
  }

  const secretary = parsed.officers.find(o => o.position.trim().toUpperCase() === 'SECRETARY');
  const directors = parsed.officers
    .filter(o => o.position.trim().toUpperCase() === 'DIRECTOR')
    .map(o => ({
      name: o.name, address: o.address,
      identificationType: o.idNo ? inferIdType(o.idNo) : '',
      identificationNumber: o.idNo, nationality: o.nationality,
    }));
  const shareholders = parsed.shareholders.map(s => ({
    name: s.name, address: s.address,
    identificationType: s.idNo ? inferIdType(s.idNo) : '',
    identificationNumber: s.idNo, nationality: s.nationality,
    numberOfShares: s.numberOfShares,
  }));

  return NextResponse.json({
    company: {
      name: parsed.company.name,
      uen: parsed.company.uen,
      regDate: toIsoDate(parsed.company.incorporationDate),
      address: parsed.company.registeredAddress,
      secretaryName: secretary?.name || '',
    },
    directors,
    shareholders,
    // Not currently wired into any form field — Post Incorporate's 16
    // templates don't reference them (verified directly against the real
    // template files) — but returned for transparency/future use rather
    // than silently discarded, since ACRA's own extract has them.
    extra: {
      companyType: parsed.company.companyType,
      primaryActivity: parsed.company.primaryActivity,
      secondaryActivity: parsed.company.secondaryActivity,
      issuedShareCapital: parsed.company.issuedShareCapital,
      paidUpCapital: parsed.company.paidUpCapital,
    },
  });
}
