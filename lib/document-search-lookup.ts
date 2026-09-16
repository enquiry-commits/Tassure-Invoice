import 'server-only';

import { createAdminClient } from './supabase';
import { companyDeepLink } from './deep-links';

// Backs the AI assistant's search_documents tool (app/api/assistant/
// route.ts) — full-text search over nas_documents (see scripts/add-nas-
// document-index.sql), the internal-network NAS document index. Vincent,
// 2026-09-16: "连内容都索引" — this searches actual file CONTENT, not just
// filenames.
//
// INV-DATA-028: sensitive data must be curated OUT at this read boundary,
// not left to the caller. A matched document's full content_text is never
// returned here — only a short snippet around the match (snippetOf below),
// same reasoning as every other *-lookup.ts file: the LLM gets just enough
// to answer, not a whole document's raw contents in its context.
export type DocumentSearchResult = {
  fileName: string;
  topFolder: string | null;
  filePath: string;
  companyId: number | null;
  companyName: string | null;
  companyLink: string | null;
  snippet: string;
  fileType: string | null;
  fileModifiedAt: string | null;
  indexedAt: string;
};

export type DocumentSearchOutcome = {
  totalMatched: number;
  returned: number;
  truncated: boolean;
  query: string;
  companyFiltered: boolean;
  results: DocumentSearchResult[];
};

const SNIPPET_RADIUS = 160;

// Postgres's own ts_headline() would need a dedicated RPC function (Vincent
// would need to run yet another migration just for it) — a plain
// case-insensitive scan for the first query word actually present in
// content_text, expanded to a fixed radius, gets the same "show the matched
// context, not the whole file" result without that extra piece of schema.
// Falls back to the start of the document on the rare case none of the query
// words appear verbatim (stemming/full-text match found it, e.g. plural vs
// singular, but no literal substring did).
function snippetOf(content: string | null, query: string): string {
  const text = (content ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const lower = text.toLowerCase();
  let hitIndex = -1;
  for (const word of words) {
    const idx = lower.indexOf(word);
    if (idx !== -1 && (hitIndex === -1 || idx < hitIndex)) hitIndex = idx;
  }
  if (hitIndex === -1) return text.length > SNIPPET_RADIUS * 2 ? `${text.slice(0, SNIPPET_RADIUS * 2)}…` : text;
  const start = Math.max(0, hitIndex - SNIPPET_RADIUS);
  const end = Math.min(text.length, hitIndex + SNIPPET_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

// plainto_tsquery handles punctuation/multi-word input safely on its own —
// no manual escaping needed, unlike a raw ilike pattern.
export async function searchDocuments(input: {
  query: string;
  companyId?: number;
  limit?: number;
}): Promise<DocumentSearchOutcome> {
  const sb = createAdminClient();
  const query = input.query.trim();
  const limit = Math.min(Math.max(input.limit ?? 10, 1), 50);

  let request = sb
    .from('nas_documents')
    .select('file_path, file_name, top_folder, company_id, content_text, file_type, file_modified_at, indexed_at', { count: 'exact' })
    .textSearch('content_tsv', query, { type: 'plain', config: 'english' })
    .order('indexed_at', { ascending: false })
    .limit(limit);
  if (input.companyId) request = request.eq('company_id', input.companyId);

  const { data, count, error } = await request;
  if (error) throw new Error(`Unable to search NAS documents: ${error.message}`);

  const rows = data ?? [];
  const companyIds = [...new Set(rows.map(r => r.company_id).filter((id): id is number => id != null))];
  const { data: companies } = companyIds.length
    ? await sb.from('companies').select('id, company_name').in('id', companyIds)
    : { data: [] as { id: number; company_name: string }[] };
  const nameById = new Map((companies ?? []).map(c => [c.id, c.company_name]));

  return {
    totalMatched: count ?? rows.length,
    returned: rows.length,
    truncated: (count ?? rows.length) > rows.length,
    query,
    companyFiltered: !!input.companyId,
    results: rows.map(row => ({
      fileName: row.file_name,
      topFolder: row.top_folder,
      filePath: row.file_path,
      companyId: row.company_id,
      companyName: row.company_id ? nameById.get(row.company_id) ?? null : null,
      companyLink: row.company_id ? companyDeepLink(row.company_id) : null,
      snippet: snippetOf(row.content_text, query),
      fileType: row.file_type,
      fileModifiedAt: row.file_modified_at,
      indexedAt: row.indexed_at,
    })),
  };
}
