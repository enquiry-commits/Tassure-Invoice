import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    QB_CLIENT_ID:      process.env.QB_CLIENT_ID      ? `${process.env.QB_CLIENT_ID.slice(0, 8)}...` : 'MISSING',
    QB_CLIENT_SECRET:  process.env.QB_CLIENT_SECRET  ? `${process.env.QB_CLIENT_SECRET.slice(0, 6)}...` : 'MISSING',
    QB_REDIRECT_URI:   process.env.QB_REDIRECT_URI   ?? 'MISSING',
    QB_ENVIRONMENT:    process.env.QB_ENVIRONMENT    ?? 'MISSING',
  });
}
