import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import {
  generatePostIncorporateDocuments, validatePostIncorporateInput,
  type PostIncorporateInput,
} from '@/lib/docx-post-incorporate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  let input: PostIncorporateInput;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const errors = validatePostIncorporateInput(input);
  if (errors.length) return NextResponse.json({ error: errors.join(' ') }, { status: 400 });

  let docs: ReturnType<typeof generatePostIncorporateDocuments>;
  try {
    docs = generatePostIncorporateDocuments(input);
  } catch (error) {
    console.error('Post Incorporate document generation failed:', error);
    return NextResponse.json({ error: 'Document generation failed. Please check the templates and try again.' }, { status: 500 });
  }

  const zip = new JSZip();
  for (const doc of docs) zip.file(doc.filename, doc.buffer);
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

  const supabase = createAdminClient();
  const { error: insertError } = await supabase.from('post_incorporate_operations').insert({
    company_name: input.company.name.trim(),
    company_uen: input.company.uen.trim(),
    need_nd_service: input.company.needNdService,
    form_data: input,
    generated_files: docs.map(d => d.filename),
    created_by_email: account.email,
    created_by_name: account.name,
  });
  if (insertError) console.error('Failed to record post_incorporate_operations row:', insertError);

  const safeCompanyName = input.company.name.trim().replace(/[\\/:*?"<>|]+/g, '_') || 'Company';
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

  return new Response(new Uint8Array(zipBuffer), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeCompanyName}-Post-Incorporate-${date}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}
