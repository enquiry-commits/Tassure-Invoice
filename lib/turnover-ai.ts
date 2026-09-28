import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// Shared by every app/api/turnover-ai/* route — the Claude vision
// extraction call, the bucket this feature's original files live in, and
// the basic duplicate-receipt reminder (see scripts/add-turnover-ai.sql's
// header for the 4 business rules this file implements).

export type TurnoverConfidence = 'high' | 'medium' | 'low';

export type ExtractedReceipt = {
  vendor: string | null;
  txnDate: string | null; // YYYY-MM-DD, or null if unreadable
  amount: number | null;
  currency: string | null;
  confidence: TurnoverConfidence;
  confidenceReason: string;
};

export const STORAGE_BUCKET = 'turnover-ai-documents';

const ASSISTANT_MODEL = process.env.ASSISTANT_MODEL || 'claude-sonnet-5';

// One tool, forced (tool_choice), so the response is always the same
// structured shape — no free-text reply to parse. Mirrors the pattern
// app/api/assistant/route.ts already uses for its own Claude tool-use loop
// (same model env var, same raw fetch to /v1/messages), just a single
// forced call instead of a multi-turn loop.
const EXTRACT_TOOL = {
  name: 'record_receipts',
  description: 'Record every distinct receipt, invoice or transaction slip visible in this document — a single file can contain several stitched together (e.g. a multi-page scan, or several photographed slips on one page).',
  input_schema: {
    type: 'object',
    properties: {
      receipts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            vendor: { type: 'string', description: 'The merchant/business name on the receipt. Empty string if genuinely illegible.' },
            txn_date: { type: 'string', description: 'Transaction date as YYYY-MM-DD. Empty string if unreadable.' },
            amount: { type: 'number', description: 'The final total amount actually paid. Your best reading even if partly obscured; 0 only if truly unreadable.' },
            currency: { type: 'string', description: '3-letter currency code as best inferred, e.g. SGD, RMB.' },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'high = vendor, date and amount are all clearly legible. medium = mostly legible but something is cropped, ambiguous, or inferred. low = the amount itself could not be reliably read.' },
            confidence_reason: { type: 'string', description: 'One short phrase explaining the confidence level, e.g. "edge of receipt cut off" or "clear e-invoice, all fields printed".' },
          },
          required: ['vendor', 'txn_date', 'amount', 'currency', 'confidence', 'confidence_reason'],
        },
      },
    },
    required: ['receipts'],
  },
};

type ClaudeToolUseBlock = { type: 'tool_use'; name: string; input: { receipts?: unknown[] } };
type ClaudeContentBlock = ClaudeToolUseBlock | { type: string };
type ClaudeMessagesResponse = { content?: ClaudeContentBlock[]; error?: { message?: string } };

export async function extractReceipts(params: { base64: string; mediaType: string; kind: 'image' | 'document' }): Promise<ExtractedReceipt[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured — Turnover AI cannot read documents in this environment yet.');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ASSISTANT_MODEL,
      max_tokens: 2048,
      tools: [EXTRACT_TOOL],
      tool_choice: { type: 'tool', name: 'record_receipts' },
      system: 'You read receipts, invoices and transaction slips for a Singapore corporate-services accounting team calculating a client\'s turnover. A single uploaded file may contain multiple distinct receipts stitched together (e.g. several photographed slips scanned onto one page) — find and record EVERY one separately, never merge them into one total. Chinese 电子发票 (e-invoices) are usually fully legible: high confidence. A photographed or scanned receipt may be cropped, blurry, or sit under a garbled/rotated underlying text layer — always read the VISIBLE IMAGE directly rather than trusting any text layer. Never invent a vendor, date or amount you cannot actually see: mark it low confidence and say why in confidence_reason instead of guessing silently.',
      messages: [{
        role: 'user',
        content: [
          { type: params.kind, source: { type: 'base64', media_type: params.mediaType, data: params.base64 } },
          { type: 'text', text: 'Record every receipt in this document using the record_receipts tool.' },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Claude extraction failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const json = await res.json() as ClaudeMessagesResponse;
  const toolUse = (json.content ?? []).find((c): c is ClaudeToolUseBlock => c.type === 'tool_use' && (c as ClaudeToolUseBlock).name === 'record_receipts');
  if (!toolUse) throw new Error('Claude did not return a structured result for this document.');

  const receipts = Array.isArray(toolUse.input.receipts) ? toolUse.input.receipts : [];
  return receipts.map((raw): ExtractedReceipt => {
    const r = raw as Record<string, unknown>;
    const vendor = typeof r.vendor === 'string' ? r.vendor.trim() : '';
    const txnDate = typeof r.txn_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.txn_date) ? r.txn_date : null;
    const amount = typeof r.amount === 'number' && Number.isFinite(r.amount) ? r.amount : null;
    const currency = typeof r.currency === 'string' ? r.currency.trim().toUpperCase().slice(0, 8) : '';
    const confidence: TurnoverConfidence = r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low' ? r.confidence : 'low';
    const confidenceReason = typeof r.confidence_reason === 'string' ? r.confidence_reason.trim() : '';
    return {
      vendor: vendor || null,
      txnDate,
      amount,
      currency: currency || null,
      confidence,
      confidenceReason,
    };
  });
}

// Basic reminder, not a hard block (Vincent, via AskUserQuestion: "做基础提
// 醒") — same client + same vendor + same date + same amount already
// recorded on a DIFFERENT document. A human still decides on the Review
// Queue; this only sets is_duplicate_suspect so it's visible there.
export async function findDuplicateSuspect(supabase: SupabaseClient, params: {
  clientName: string; vendor: string | null; txnDate: string | null; amount: number | null;
}): Promise<number | null> {
  if (!params.vendor || !params.txnDate || params.amount === null) return null;
  const { data: docs } = await supabase.from('turnover_documents').select('id').eq('client_name', params.clientName);
  const docIds = (docs ?? []).map((d: { id: number }) => d.id);
  if (!docIds.length) return null;
  const { data } = await supabase.from('turnover_line_items')
    .select('id')
    .in('document_id', docIds)
    .eq('vendor_name', params.vendor)
    .eq('txn_date', params.txnDate)
    .eq('amount', params.amount)
    .limit(1);
  return data?.[0]?.id ?? null;
}

// Storage has never been used anywhere else in this codebase (confirmed by
// a full-repo search before writing this) — this is the first real use, so
// the bucket is created lazily/idempotently here rather than assuming a
// human already set it up in the Supabase dashboard. Private (no `public`
// option passed — defaults to private): receipts can carry partial card/
// account info, originals are only ever served back via a short-lived
// signed URL (see app/api/turnover-ai/file/[id]/route.ts).
export async function ensureBucket(supabase: SupabaseClient): Promise<void> {
  const { data } = await supabase.storage.getBucket(STORAGE_BUCKET);
  if (data) return;
  const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, { public: false });
  // A race with another concurrent request creating it first is not a real
  // failure — only surface an error that isn't "already exists".
  if (error && !/already exists/i.test(error.message)) throw error;
}
