import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export async function GET() {
  const dataDir = path.join(process.cwd(), 'data');

  const clients: Record<string, unknown>[] = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'clients_merged.json'), 'utf8')
  );
  const ndByCompany: Record<string, unknown>[] = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'nd_by_company.json'), 'utf8')
  );
  const ndPersons: Record<string, unknown>[] = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'nd_from_individuals.json'), 'utf8')
  );

  const totalClients = clients.length;
  const withAddress  = clients.filter((c: Record<string, unknown>) => c.usesAddressService).length;

  const activeNDCompanies = ndByCompany.filter((c: Record<string, unknown>) => c.hasActiveND).length;
  const ceasedOnlyCompanies = ndByCompany.filter(
    (c: Record<string, unknown>) => !c.hasActiveND && Array.isArray(c.ndPersons) && (c.ndPersons as unknown[]).length > 0
  ).length;

  const activeNDPersons = ndPersons.filter(
    (p: Record<string, unknown>) => (p.activeCount as number) > 0
  ).length;

  return NextResponse.json({
    totalClients,
    withAddress,
    activeNDCompanies,
    ceasedOnlyCompanies,
    activeNDPersons,
    totalNDPersons: ndPersons.length,
  });
}
