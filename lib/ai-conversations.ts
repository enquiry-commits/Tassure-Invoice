import 'server-only';

import { createAdminClient } from './supabase';

// Persisted chat threads for the new My Tasks chat interface — Vincent:
// "My Tasks 这个页面是好像AI聊天这样的界面，好像 Chatgpt/ Claude 这样的，
// 可以New Chat, 记录Chats and tasks, 可以 Pin/ Pinned". Table names
// (ai_conversations/ai_messages) match his own shared blueprint's
// "Suggested Database" section rather than inventing different ones for
// the same concept (scripts/add-ai-conversations.sql).
export type Conversation = {
  id: number;
  account_email: string;
  title: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

// Added 2026-09-09 (scripts/add-ai-messages-preview-data.sql) — Vincent,
// after testing the agentic-chat preview cards live: "我发现每次只能看到
// 一次，当我切换了页面或者点击了接口，这个预览和深链的记录就不见了".
// The 4 preview types (InvoicePreview / LateFilingResolvePreview /
// InvoiceEditPreview / PostIncorporatePreview, each in its own lib module)
// are deliberately NOT imported here — this module stays a general-purpose
// persistence layer, agnostic to which tool produced a given reply.
// app/api/assistant/route.ts decides the `type`/`data` shape; this file
// just stores and returns it opaquely.
export type StoredPreview = {
  type: 'invoice_draft' | 'late_filing_resolve' | 'invoice_edit' | 'post_incorporate' | 'ar_update';
  data: Record<string, unknown>;
};

export type ConversationMessage = {
  id: number;
  conversation_id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  preview_data?: StoredPreview | null;
};

// Pinned first, then most-recently-updated — matches the ChatGPT sidebar
// convention Vincent's screenshot showed (a "Pinned" section above
// "Recent"), computed here once so the API route and any future consumer
// can't render the two groups in a different order from each other.
export async function listConversations(email: string): Promise<Conversation[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('ai_conversations')
    .select('*')
    .eq('account_email', email)
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false });
  return (data ?? []) as Conversation[];
}

export async function createConversation(email: string, title = 'New chat'): Promise<Conversation> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('ai_conversations')
    .insert({ account_email: email, title })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Conversation;
}

// Ownership-scoped on every call below — never let one account touch
// another's conversation by guessing an id, same convention as every
// other per-account resource in this app (e.g. lib/user-memories.ts).
export async function getConversationOwner(id: number): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase.from('ai_conversations').select('account_email').eq('id', id).maybeSingle();
  return data?.account_email ?? null;
}

export async function renameConversation(id: number, title: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from('ai_conversations').update({ title, updated_at: new Date().toISOString() }).eq('id', id);
}

export async function setConversationPinned(id: number, pinned: boolean): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from('ai_conversations').update({ pinned }).eq('id', id);
}

export async function deleteConversation(id: number): Promise<void> {
  const supabase = createAdminClient();
  // ai_messages rows cascade-delete via the FK's ON DELETE CASCADE
  // (scripts/add-ai-conversations.sql) — no separate cleanup needed here.
  await supabase.from('ai_conversations').delete().eq('id', id);
}

export async function listMessages(conversationId: number): Promise<ConversationMessage[]> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('ai_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return (data ?? []) as ConversationMessage[];
}

export async function appendMessage(conversationId: number, role: 'user' | 'assistant', content: string, previewData?: StoredPreview | null): Promise<void> {
  const supabase = createAdminClient();
  if (previewData !== undefined) {
    const { error } = await supabase.from('ai_messages').insert({ conversation_id: conversationId, role, content, preview_data: previewData });
    if (!error) return;
    // The preview_data column might not be migrated onto this database yet
    // (scripts/add-ai-messages-preview-data.sql) — never let an optional,
    // additive column being absent break the base save that has worked all
    // along; fall through to the plain insert below instead.
  }
  await supabase.from('ai_messages').insert({ conversation_id: conversationId, role, content });
}

// Auto-title on the FIRST real exchange, ChatGPT-style — a short
// truncation of the user's own opening message rather than a second LLM
// call just to name the thread (the blueprint's own MVP guidance, section
// 16: don't over-build before there's a real need). Only fires while the
// title is still the untouched default, so a user's own rename is never
// silently overwritten by a later message.
export function deriveTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim().replace(/\s+/g, ' ');
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed || 'New chat';
}

export async function touchConversation(conversationId: number): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
}
