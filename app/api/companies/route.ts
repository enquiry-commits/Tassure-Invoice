import { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';

export async function GET(req: NextRequest) {
  const dataDir = path.join(process.cwd(), 'data');
  const clients: Record<string, unknown>[] = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'clients_merged.json'), 'utf8')
  );
  const ndByCompany: Record<string, unknown>[] = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'nd_by_company.json'), 'utf8')
  );

  // Build ND lookup by company name
  const ndMap: Record<string, { hasActiveND: boolean; activeNDs: unknown[] }> = {};
  ndByCompany.forEach((c: Record<string, unknown>) => {
    ndMap[c.companyName as string] = {
      hasActiveND: c.hasActiveND as boolean,
      activeNDs:  c.activeNDs as unknown[],
    };
  });

  const { searchParams } = new URL(req.url);
  const filter = searchParams.get('filter');
  const search = (searchParams.get('search') || '').toLowerCase();
  const page   = parseInt(searchParams.get('page') || '1', 10);
  const limit  = parseInt(searchParams.get('limit') || '50', 10);

  let data = clients.map((c: Record<string, unknown>) => {
    const nd = ndMap[c.companyName as string];
    return { ...c, hasActiveND: nd?.hasActiveND ?? false, activeNDs: nd?.activeNDs ?? [] };
  });

  if (filter === 'nd')      data = data.filter(c => c.hasActiveND);
  if (filter === 'address') data = data.filter(c => c.usesAddressService);
  if (filter === 'nd-ceased') data = data.filter(c => !c.hasActiveND && ndMap[c.companyName as string]);
  if (search) {
    data = data.filter(c =>
      (c.companyName as string).toLowerCase().includes(search) ||
      (c.registrationNo as string || '').toLowerCase().includes(search)
    );
  }

  const total = data.length;
  const sliced = data.slice((page - 1) * limit, page * limit);

  return NextResponse.json({ total, page, limit, data: sliced });
}
