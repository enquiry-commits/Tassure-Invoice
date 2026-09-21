import 'server-only';

import { createAdminClient } from '../supabase';
import type { AgentRoute } from './orchestrator';

export async function recordAgentRun(params: {
  accountEmail: string;
  conversationId?: number;
  route: AgentRoute | 'intent_fallback';
  primaryProvider: string;
  primaryModel?: string | null;
  secondaryProvider?: string | null;
  secondaryModel?: string | null;
  toolNames?: string[];
  status: 'completed' | 'fallback' | 'failed';
  latencyMs: number;
  error?: string | null;
}): Promise<number | null> {
  try {
    const supabase = createAdminClient();
    let conversationId: number | null = null;
    if (params.conversationId) {
      const { data: conversation } = await supabase
        .from('ai_conversations')
        .select('account_email')
        .eq('id', params.conversationId)
        .maybeSingle();
      // A caller can submit an arbitrary numeric conversationId. Telemetry
      // must never link this user's run to somebody else's conversation,
      // even though the later message-persistence layer also checks owner.
      if (conversation?.account_email?.toLowerCase() === params.accountEmail.toLowerCase()) conversationId = params.conversationId;
    }
    const { data, error } = await supabase.from('ai_agent_runs').insert({
      account_email: params.accountEmail,
      conversation_id: conversationId,
      route: params.route,
      primary_provider: params.primaryProvider,
      primary_model: params.primaryModel ?? null,
      secondary_provider: params.secondaryProvider ?? null,
      secondary_model: params.secondaryModel ?? null,
      tool_names: params.toolNames ?? [],
      status: params.status,
      latency_ms: Math.max(0, Math.round(params.latencyMs)),
      error: params.error?.slice(0, 1000) ?? null,
    }).select('id').single();
    if (error) return null; // migration may not be deployed yet
    return Number(data.id);
  } catch {
    return null;
  }
}
