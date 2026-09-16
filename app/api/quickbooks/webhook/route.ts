import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { processQuickBooksWebhookQueue } from '@/lib/quickbooks-webhook-queue';

export const maxDuration = 60;

type WebhookEvent = {
  eventId: string;
  realmId: string;
  entityName: string;
  entityId: string;
  operation: string;
  changedAt: string;
};

function safeTimestamp(value: unknown) {
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function eventId(parts: unknown[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

// QuickBooks webhook's own entity resource names (the <entity> in
// "qbo.<entity>.<op>.vN", lowercased for matching) — NOT the
// AgedReceivableDetail report's own display-column wording ("Credit
// Note"/"Journal Entry", with spaces — see lib/quickbooks-ar-aging.ts's
// txn_type comment). Confirmed against this codebase's own
// `SELECT * FROM CreditMemo` (syncCreditMemoYear, app/api/quickbooks/
// sync/route.ts) that the real API/webhook resource name is "CreditMemo",
// one word — never "fix" this map to match the report's wording, they are
// two different vocabularies for the same underlying QuickBooks object.
//
// 2026-09-16: widened from Invoice-only (the original, narrower scope this
// pipeline was built for — CDC-based invoice/PIC-signal freshness) to also
// include the other 4 entity types INV-QB-017 confirmed actually affect
// this business's real AR balance (Payment, CreditMemo, JournalEntry,
// Deposit) — lib/quickbooks-webhook-queue.ts now triggers a fresh
// AgedReceivableDetail report re-sync (not per-entity-type logic — see
// docs/INVARIANTS.md INV-QB-021) whenever any of these change, so the
// Outstanding List updates near-real-time instead of waiting for the
// once-daily cron. Previously every non-Invoice event was silently
// dropped right here before even reaching the queue table.
const TRACKED_ENTITIES: Record<string, string> = {
  invoice: 'Invoice',
  payment: 'Payment',
  creditmemo: 'CreditMemo',
  journalentry: 'JournalEntry',
  deposit: 'Deposit',
};

function parseWebhookPayload(payload: unknown): WebhookEvent[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((raw, index) => {
      const event = (raw ?? {}) as Record<string, unknown>;
      const type = String(event.type ?? '').toLowerCase();
      const match = /^qbo\.([^.]+)\.([^.]+)\.v\d+$/.exec(type);
      const entityName = match ? TRACKED_ENTITIES[match[1]] : undefined;
      if (!match || !entityName) {
        if (match) console.warn('QuickBooks webhook: unrecognized entity type', match[1], String(event.intuitaccountid ?? ''));
        return [];
      }
      const realmId = String(event.intuitaccountid ?? '');
      const entityId = String(event.intuitentityid ?? '');
      if (!realmId || !entityId) return [];
      const changedAt = safeTimestamp(event.time);
      return [{
        eventId: String(event.id ?? '') || eventId([realmId, entityId, match[2], changedAt, index]),
        realmId,
        entityName,
        entityId,
        operation: match[2],
        changedAt,
      }];
    });
  }

  const legacy = (payload ?? {}) as {
    eventNotifications?: Array<{
      realmId?: unknown;
      dataChangeEvent?: { entities?: Array<Record<string, unknown>> };
    }>;
  };
  return (legacy.eventNotifications ?? []).flatMap((notification, notificationIndex) => {
    const realmId = String(notification.realmId ?? '');
    return (notification.dataChangeEvent?.entities ?? []).flatMap((entity, entityIndex) => {
      const rawName = String(entity.name ?? '').toLowerCase();
      const entityName = TRACKED_ENTITIES[rawName];
      if (!entityName) {
        if (rawName) console.warn('QuickBooks webhook: unrecognized entity type', rawName, realmId);
        return [];
      }
      const entityId = String(entity.id ?? '');
      if (!realmId || !entityId) return [];
      const operation = String(entity.operation ?? 'Update').toLowerCase();
      const changedAt = safeTimestamp(entity.lastUpdated);
      return [{
        eventId: eventId([realmId, entityId, operation, changedAt, notificationIndex, entityIndex]),
        realmId,
        entityName,
        entityId,
        operation,
        changedAt,
      }];
    });
  });
}

function validSignature(rawBody: string, signature: string | null, verifier: string) {
  if (!signature) return false;
  const expected = createHmac('sha256', verifier).update(rawBody, 'utf8').digest('base64');
  const actualBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function POST(req: NextRequest) {
  const verifier = process.env.QB_WEBHOOK_VERIFIER_TOKEN;
  if (!verifier) return NextResponse.json({ error: 'QuickBooks webhook is not configured.' }, { status: 503 });

  const rawBody = await req.text();
  if (!validSignature(rawBody, req.headers.get('intuit-signature'), verifier)) {
    return NextResponse.json({ error: 'Invalid QuickBooks webhook signature.' }, { status: 401 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid webhook JSON.' }, { status: 400 });
  }
  const events = parseWebhookPayload(parsed);
  if (events.length) {
    const { error } = await createAdminClient().from('quickbooks_webhook_events').upsert(events.map(event => ({
      event_id: event.eventId,
      realm_id: event.realmId,
      entity_name: event.entityName,
      entity_id: event.entityId,
      operation: event.operation,
      changed_at: event.changedAt,
      status: 'pending',
      last_error: null,
    })), { onConflict: 'event_id', ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: `Unable to queue QuickBooks event: ${error.message}` }, { status: 503 });

    after(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const result = await processQuickBooksWebhookQueue();
          if (!result.skipped) return;
        } catch (error) {
          console.error('QuickBooks webhook processing failed:', error instanceof Error ? error.message : error);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
    });
  }

  return NextResponse.json({ ok: true, accepted: events.length });
}
