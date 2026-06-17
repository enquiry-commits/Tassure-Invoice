import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

export async function GET() {
  const dataDir = path.join(process.cwd(), 'data');
  const ndPersons = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'nd_from_individuals.json'), 'utf8')
  );
  return NextResponse.json(ndPersons);
}
