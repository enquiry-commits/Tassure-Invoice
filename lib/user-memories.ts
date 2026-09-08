import 'server-only';

import { createAdminClient } from './supabase';

// Structured long-term memory — Vincent's shared blueprint, section 5:
// "Memory Type... Fact / Preference / Behaviour / Relationship / Project /
// Decision / Rejection / Pattern", each with confidence + source_count +
// last_seen (section 5.1: "AI 不应因为一次对话就永久定义用户... 每条行为
// 型记忆应带置信度、观察次数、来源与最后更新时间").
//
// v1 write path (see app/api/assistant/route.ts's remember_this tool) is
// explicit-only — a user directly asking the AI to remember something —
// never automatic pattern-mining from user_activity_events. That's a
// deliberate, stated scope decision (see scripts/add-user-memories.sql's
// own comment), not an oversight.
export type MemoryType = 'fact' | 'preference' | 'behaviour' | 'relationship' | 'project' | 'decision' | 'rejection' | 'pattern';

export type UserMemory = {
  id: number;
  account_email: string;
  memory_type: MemoryType;
  content: string;
  confidence: number;
  source_count: number;
  source: 'explicit' | 'inferred';
  last_seen: string;
  created_at: string;
};

export async function createMemory(email: string, memoryType: MemoryType, content: string): Promise<UserMemory> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('user_memories')
    .insert({ account_email: email, memory_type: memoryType, content, source: 'explicit' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as UserMemory;
}

// Most-recent-first, capped — this feeds directly into the assistant's own
// system prompt as part of its "Context Package" (blueprint section 11),
// so it must stay small and relevant, never the full history.
export async function listMemories(email: string, limit = 20): Promise<UserMemory[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('user_memories')
    .select('*')
    .eq('account_email', email)
    .order('last_seen', { ascending: false })
    .limit(limit);
  return (data ?? []) as UserMemory[];
}

export async function deleteMemory(email: string, id: number): Promise<void> {
  const supabase = createAdminClient();
  // Scoped to the owning account too, not just the id — never let one
  // account delete another's memory by guessing an id.
  await supabase.from('user_memories').delete().eq('id', id).eq('account_email', email);
}
