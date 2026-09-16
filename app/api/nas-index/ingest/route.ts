import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { withAutomationRun } from '@/lib/automation-sync';
import { resolveCompany } from '@/lib/company-name';

export const maxDuration = 60;

// Receives batches of file content indexed by a script running on the office
// NAS device itself (see scripts/add-nas-document-index.sql's header for the
// full context — tassure-invoice runs on Vercel, which cannot reach into the
// office LAN, so this is the one direction that works: the always-on NAS
// pushes to us, the same shape as the QuickBooks webhook, not a cron pulling
// outward). PUBLIC_PATHS in proxy.ts lets this route bypass the normal
// Tassure Google session check — a NAS script has no such session — and this
// route self-authenticates the raw body with an HMAC signature instead, same
// pattern as app/api/quickbooks/webhook/route.ts's validSignature().
const MAX_BATCH = 20;

type IncomingFile = {
  filePath: unknown;
  fileName: unknown;
  topFolder?: unknown;
  // The folder name to resolve against companies.company_name — NOT
  // necessarily the same as topFolder (e.g. topFolder "All Clients Profile",
  // folderName "Taiyau Trading Pte Ltd"). Left unset when a file sits
  // directly under a non-client folder (e.g. "Marketing") — company_id/
  // raw_folder_name both stay null in that case, which is correct, not a
  // gap.
  folderName?: unknown;
  contentText?: unknown;
  fileType?: unknown;
  fileSizeBytes?: unknown;
  contentHash?: unknown;
  fileModifiedAt?: unknown;
};

function validSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const actualBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function POST(req: NextRequest) {
  const secret = process.env.NAS_INDEX_SECRET;
  if (!secret) return NextResponse.json({ error: 'NAS document indexing is not configured.' }, { status: 503 });

  const rawBody = await req.text();
  if (!validSignature(rawBody, req.headers.get('x-nas-index-signature'), secret)) {
    return NextResponse.json({ error: 'Invalid NAS index signature.' }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const files = Array.isArray((parsed as { files?: unknown })?.files) ? (parsed as { files: IncomingFile[] }).files : [];
  if (!files.length) return NextResponse.json({ error: 'No files in batch.' }, { status: 400 });
  if (files.length > MAX_BATCH) {
    return NextResponse.json({ error: `Batch too large — max ${MAX_BATCH} files per request, got ${files.length}.` }, { status: 400 });
  }

  return withAutomationRun(req, 'nas_index', async (run) => {
    const sb = createAdminClient();
    const { data: companies, error: companiesError } = await sb.from('companies').select('id, company_name');
    if (companiesError) return NextResponse.json({ error: companiesError.message }, { status: 503 });

    const now = new Date().toISOString();
    let matched = 0;
    let unmatched = 0;
    const rows = [];
    for (const file of files) {
      const filePath = String(file.filePath ?? '').trim();
      const fileName = String(file.fileName ?? '').trim();
      if (!filePath || !fileName) continue;

      const folderName = typeof file.folderName === 'string' ? file.folderName.trim() : '';
      let companyId: number | null = null;
      if (folderName && companies?.length) {
        const resolution = resolveCompany(folderName, companies, c => c.company_name);
        if (resolution.kind === 'exact' || resolution.kind === 'best') {
          companyId = resolution.value.id;
          matched++;
        } else {
          unmatched++;
        }
      }

      rows.push({
        file_path: filePath,
        file_name: fileName,
        top_folder: typeof file.topFolder === 'string' ? file.topFolder : null,
        company_id: companyId,
        raw_folder_name: folderName || null,
        content_text: typeof file.contentText === 'string' ? file.contentText : null,
        file_type: typeof file.fileType === 'string' ? file.fileType : null,
        file_size_bytes: typeof file.fileSizeBytes === 'number' ? file.fileSizeBytes : null,
        content_hash: typeof file.contentHash === 'string' ? file.contentHash : null,
        file_modified_at: typeof file.fileModifiedAt === 'string' ? file.fileModifiedAt : null,
        indexed_at: now,
        sync_run_id: run.id,
        updated_at: now,
      });
    }

    if (!rows.length) return NextResponse.json({ error: 'No valid files in batch (each needs filePath and fileName).' }, { status: 400 });

    const { error } = await sb.from('nas_documents').upsert(rows, { onConflict: 'file_path' });
    if (error) return NextResponse.json({ error: `Unable to upsert NAS documents: ${error.message}` }, { status: 503 });

    return NextResponse.json({ ok: true, processed: rows.length, matched, unmatched });
  });
}
