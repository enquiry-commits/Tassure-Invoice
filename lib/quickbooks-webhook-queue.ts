import 'server-only';

import { AutomationRun, replaceAutomationExceptions } from '@/lib/automation-sync';
import { syncQuickBooksInvoiceChanges } from '@/lib/quickbooks-invoice-incremental';
import { syncAgedReceivableDetail } from '@/lib/quickbooks-ar-aging';
import { createAdminClient } from '@/lib/supabase';
import type { QbCompany } from '@/lib/quickbooks';

type QueueRow = {
  event_id: string;
  realm_id: string;
  changed_at: string;
  attempts: number;
  entity_name: string;
};

// 2026-09-16: which webhook entity types genuinely affect a customer's AR
// balance (confirmed 2026-09-15 via live AgedReceivableDetail — see
// docs/INVARIANTS.md INV-QB-017/021) — every entity type this route's own
// TRACKED_ENTITIES allowlist (app/api/quickbooks/webhook/route.ts) accepts
// is currently one of these 5, so this check is always true today; kept as
// an explicit named set rather than removed so a FUTURE tracked-but-not-
// AR-relevant entity type doesn't silently start triggering unnecessary
// live Report API calls.
const TRACKED_AR_ENTITIES = new Set(['Invoice', 'Payment', 'CreditMemo', 'JournalEntry', 'Deposit']);

// Minimum gap between two AgedReceivableDetail report re-syncs triggered
// BY WEBHOOK EVENTS for the same company — a full report re-fetch, not an
// incremental delta, so skipping a trigger never loses data (the very next
// webhook event for that company, or the next daily cron, always catches
// up). This collapses a realistic burst (several payments processed
// back-to-back) into one live QuickBooks Report API call instead of one
// per event. Deliberately checked HERE, not inside syncAgedReceivableDetail
// itself, so the daily cron's and the manual-trigger route's own
// unconditional calls are never rate-limited by this.
const AR_AGING_MIN_INTERVAL_MS = 60_000;

type QueueSummary = {
  queued: number;
  processed: number;
  failed: number;
  skipped?: boolean;
  changes: Array<Record<string, unknown>>;
};

function cdcStart(events: QueueRow[]) {
  const earliest = Math.min(...events.map(event => new Date(event.changed_at).getTime()).filter(Number.isFinite));
  const fallback = Date.now() - 10 * 60_000;
  const requested = (Number.isFinite(earliest) ? earliest : fallback) - 2 * 60_000;
  const oldestAllowed = Date.now() - 29 * 24 * 60 * 60_000;
  return new Date(Math.max(requested, oldestAllowed)).toISOString();
}

async function markEvents(ids: string[], patch: Record<string, unknown>) {
  if (!ids.length) return;
  const { error } = await createAdminClient().from('quickbooks_webhook_events').update(patch).in('event_id', ids);
  if (error) throw new Error(`Unable to update QuickBooks webhook queue: ${error.message}`);
}

export async function processQuickBooksWebhookQueue(existingRun?: AutomationRun): Promise<QueueSummary> {
  const ownsRun = !existingRun;
  const run = existingRun ?? await AutomationRun.begin('quickbooks', 'manual', 5);
  if (!run.acquired) return { queued: 0, processed: 0, failed: 0, skipped: true, changes: [] };

  const supabase = createAdminClient();
  const summary: QueueSummary = { queued: 0, processed: 0, failed: 0, changes: [] };
  const failures: Array<{ key: string; name: string; details: Record<string, unknown> }> = [];
  try {
    const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    await supabase.from('quickbooks_webhook_events').update({
      status: 'failed',
      last_error: 'Previous webhook processor stopped before completion.',
      processing_started_at: null,
    }).eq('status', 'processing').lt('processing_started_at', staleBefore);

    const { data, error } = await supabase.from('quickbooks_webhook_events')
      .select('event_id, realm_id, changed_at, attempts, entity_name')
      .in('status', ['pending', 'failed'])
      .lt('attempts', 5)
      .order('changed_at', { ascending: true })
      .limit(500);
    if (error) {
      // Keep daily full synchronization operational during the short setup
      // window before the webhook migration is applied.
      if (error.message.includes('quickbooks_webhook_events')) {
        const notReady = { ...summary, skipped: true };
        if (ownsRun) await run.succeed({ ...notReady, reason: 'webhook_queue_not_ready' });
        return notReady;
      }
      throw error;
    }

    const events = (data ?? []) as QueueRow[];
    summary.queued = events.length;
    if (!events.length) {
      await replaceAutomationExceptions('quickbooks', 'webhook_processing', []);
      if (ownsRun) await run.succeed(summary);
      return summary;
    }

    const claimedAt = new Date().toISOString();
    for (const event of events) {
      await markEvents([event.event_id], {
        status: 'processing',
        attempts: Number(event.attempts ?? 0) + 1,
        processing_started_at: claimedAt,
        last_error: null,
      });
    }

    const { data: tokens, error: tokenError } = await supabase.from('quickbooks_tokens')
      .select('realm_id, company_label');
    if (tokenError) throw tokenError;
    const companyByRealm = new Map<string, QbCompany>();
    for (const token of tokens ?? []) {
      if (token.company_label === 'TAB' || token.company_label === 'TAC' || token.company_label === 'TAO') {
        companyByRealm.set(String(token.realm_id), token.company_label);
      }
    }

    const byRealm = new Map<string, QueueRow[]>();
    for (const event of events) {
      const group = byRealm.get(event.realm_id) ?? [];
      group.push(event);
      byRealm.set(event.realm_id, group);
    }

    for (const [realmId, realmEvents] of byRealm) {
      const ids = realmEvents.map(event => event.event_id);
      const company = companyByRealm.get(realmId);
      if (!company) {
        await markEvents(ids, {
          status: 'failed',
          processing_started_at: null,
          last_error: `No TAB/TAC/TAO connection matches QuickBooks realm ${realmId}.`,
        });
        summary.failed += ids.length;
        failures.push({
          key: realmId,
          name: `Unknown QuickBooks company ${realmId}`,
          details: { realm_id: realmId, event_ids: ids },
        });
        continue;
      }
      try {
        const changes = await syncQuickBooksInvoiceChanges(company, cdcStart(realmEvents));
        await markEvents(ids, {
          status: 'processed',
          processed_at: new Date().toISOString(),
          processing_started_at: null,
          last_error: null,
        });
        summary.processed += ids.length;
        summary.changes.push(changes);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markEvents(ids, {
          status: 'failed',
          processing_started_at: null,
          last_error: message.slice(0, 1000),
        });
        summary.failed += ids.length;
        failures.push({
          key: `${company}:${ids[0]}`,
          name: `${company} QuickBooks webhook`,
          details: { qb_company: company, realm_id: realmId, event_ids: ids, error: message.slice(0, 1000) },
        });
      }

      // 2026-09-16: real-time Outstanding balance — trigger the SAME
      // AgedReceivableDetail report sync the daily cron uses (INV-QB-017),
      // not a second/different computation, whenever this realm's batch
      // includes an AR-relevant entity change. Deliberately independent of
      // the CDC invoice sync above (its own try/catch, its own failure
      // tracking) — a report-sync problem must never get marked against
      // the invoice/PIC-signal event's own processed/failed status, and
      // vice versa. Never throws (see this function's own error-object
      // return convention), but wrapped defensively anyway.
      if (realmEvents.some(event => TRACKED_AR_ENTITIES.has(event.entity_name))) {
        try {
          const { data: state } = await supabase
            .from('quickbooks_ar_aging_sync_state')
            .select('last_synced_at')
            .eq('qb_company', company)
            .maybeSingle();
          const lastSyncedMs = state?.last_synced_at ? new Date(state.last_synced_at).getTime() : 0;
          if (Date.now() - lastSyncedMs >= AR_AGING_MIN_INTERVAL_MS) {
            const arResult = await syncAgedReceivableDetail(company, run.id);
            summary.changes.push({ company, ar_aging: arResult });
          } else {
            summary.changes.push({ company, ar_aging_debounced: true });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push({
            key: `${company}:ar_aging_webhook`,
            name: `${company} webhook-triggered AgedReceivableDetail sync`,
            details: { qb_company: company, realm_id: realmId, error: message.slice(0, 1000) },
          });
        }
      }
      await run.heartbeat(5);
    }

    await replaceAutomationExceptions('quickbooks', 'webhook_processing', failures);
    await supabase.from('quickbooks_webhook_events').delete()
      .eq('status', 'processed')
      .lt('processed_at', new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString());

    if (ownsRun) {
      if (summary.failed) await run.fail(`${summary.failed} QuickBooks webhook event(s) failed.`, summary);
      else await run.succeed(summary);
    }
    return summary;
  } catch (error) {
    if (ownsRun) await run.fail(error, summary);
    throw error;
  }
}
