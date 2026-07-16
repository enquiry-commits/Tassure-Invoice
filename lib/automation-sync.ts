import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export type AutomationSource =
  | 'teamwork_companies'
  | 'teamwork_nd'
  | 'ar_generate'
  | 'ar_workflow'
  | 'late_filing'
  | 'quickbooks';

type JsonSummary = Record<string, unknown>;

export class AutomationRun {
  private constructor(
    readonly id: string,
    readonly source: AutomationSource,
    readonly acquired: boolean,
  ) {}

  static async begin(
    source: AutomationSource,
    triggerType: 'cron' | 'manual' = 'cron',
    leaseMinutes = 10,
  ): Promise<AutomationRun> {
    const supabase = createAdminClient();
    const id = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();

    // Expired leases must never block the next run. The primary key on source
    // still guarantees only one contender can insert the replacement lock.
    const { data: expired } = await supabase
      .from('automation_sync_locks')
      .delete()
      .eq('source', source)
      .lt('expires_at', now.toISOString())
      .select('run_id');

    const expiredRunIds = (expired ?? []).map(row => row.run_id).filter(Boolean);
    if (expiredRunIds.length) {
      await supabase
        .from('automation_sync_runs')
        .update({
          status: 'failed',
          finished_at: now.toISOString(),
          heartbeat_at: now.toISOString(),
          error: 'Previous run lease expired before completion.',
        })
        .in('id', expiredRunIds)
        .eq('status', 'running');
    }

    const { error: runError } = await supabase.from('automation_sync_runs').insert({
      id,
      source,
      trigger_type: triggerType,
      status: 'running',
      started_at: now.toISOString(),
      heartbeat_at: now.toISOString(),
    });
    if (runError) throw new Error(`Automation migration is not ready: ${runError.message}`);

    const { error: lockError } = await supabase.from('automation_sync_locks').insert({
      source,
      run_id: id,
      locked_at: now.toISOString(),
      expires_at: expiresAt,
    });

    if (lockError) {
      await supabase.from('automation_sync_runs').update({
        status: 'skipped',
        finished_at: new Date().toISOString(),
        error: 'Another run already owns the automation lease.',
      }).eq('id', id);
      return new AutomationRun(id, source, false);
    }

    return new AutomationRun(id, source, true);
  }

  async heartbeat(leaseMinutes = 10) {
    if (!this.acquired) return;
    const supabase = createAdminClient();
    const now = new Date();
    await Promise.all([
      supabase.from('automation_sync_runs').update({ heartbeat_at: now.toISOString() }).eq('id', this.id),
      supabase.from('automation_sync_locks').update({
        expires_at: new Date(now.getTime() + leaseMinutes * 60_000).toISOString(),
      }).eq('source', this.source).eq('run_id', this.id),
    ]);
  }

  async succeed(summary: JsonSummary = {}) {
    await this.finish('success', summary, null);
  }

  async fail(error: unknown, summary: JsonSummary = {}) {
    const message = error instanceof Error ? error.message : String(error);
    await this.finish('failed', summary, message.slice(0, 4000));
  }

  private async finish(status: 'success' | 'failed', summary: JsonSummary, error: string | null) {
    if (!this.acquired) return;
    const supabase = createAdminClient();
    const now = new Date().toISOString();
    await supabase.from('automation_sync_runs').update({
      status,
      summary,
      error,
      finished_at: now,
      heartbeat_at: now,
    }).eq('id', this.id);
    await supabase.from('automation_sync_locks').delete().eq('source', this.source).eq('run_id', this.id);
  }
}

export function automationTrigger(authorization: string | null): 'cron' | 'manual' {
  return authorization?.startsWith('Bearer ') ? 'cron' : 'manual';
}

export async function withAutomationRun(
  req: NextRequest,
  source: AutomationSource,
  task: (run: AutomationRun) => Promise<NextResponse>,
  leaseMinutes = 10,
): Promise<NextResponse> {
  let run: AutomationRun;
  try {
    run = await AutomationRun.begin(source, automationTrigger(req.headers.get('authorization')), leaseMinutes);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
  if (!run.acquired) {
    return NextResponse.json({ ok: false, skipped: true, error: `${source} is already running.` }, { status: 409 });
  }

  try {
    const response = await task(run);
    const summary = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok && summary.ok !== false && !summary.error) await run.succeed(summary);
    else await run.fail(String(summary.error ?? `${source} failed.`), summary);
    return response;
  } catch (error) {
    await run.fail(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function replaceAutomationExceptions(
  source: AutomationSource,
  exceptionType: string,
  items: Array<{ key: string; name?: string | null; details?: JsonSummary }>,
) {
  const supabase = createAdminClient();
  const observedAt = new Date().toISOString();
  if (items.length) {
    const { error } = await supabase.from('automation_exceptions').upsert(items.map(item => ({
      source,
      exception_type: exceptionType,
      entity_key: item.key,
      entity_name: item.name ?? null,
      details: item.details ?? {},
      status: 'open',
      last_seen_at: observedAt,
      resolved_at: null,
    })), { onConflict: 'source,exception_type,entity_key' });
    if (error) throw new Error(`Unable to record ${exceptionType} exceptions: ${error.message}`);
  }

  await supabase.from('automation_exceptions').update({
    status: 'resolved',
    resolved_at: observedAt,
  }).eq('source', source).eq('exception_type', exceptionType).eq('status', 'open').lt('last_seen_at', observedAt);
}
