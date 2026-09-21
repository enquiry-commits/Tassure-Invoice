import 'server-only';

import { createHash } from 'node:crypto';

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

type ResponseContent = { type?: string; text?: string; refusal?: string };
type ResponseItem = { type?: string; content?: ResponseContent[] };
type ResponsesPayload = { output?: ResponseItem[]; error?: { message?: string } };

export function openAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function openAIModel(kind: 'router' | 'primary' | 'learning'): string {
  if (kind === 'router') return process.env.OPENAI_ROUTER_MODEL || 'gpt-5.6-luna';
  if (kind === 'learning') return process.env.OPENAI_LEARNING_MODEL || 'gpt-5.6-terra';
  return process.env.OPENAI_ASSISTANT_MODEL || 'gpt-5.6-terra';
}

function safetyIdentifier(email?: string | null): string | undefined {
  if (!email) return undefined;
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

function outputText(payload: ResponsesPayload): string {
  return (payload.output ?? [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content ?? [])
    .filter(content => content.type === 'output_text')
    .map(content => content.text ?? '')
    .join('\n')
    .trim();
}

async function callResponses(body: Record<string, unknown>, timeoutMs: number): Promise<ResponsesPayload> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, store: false }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json().catch(() => ({})) as ResponsesPayload;
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${payload.error?.message ?? 'request failed'}`);
  return payload;
}

export async function openAIJson<T>(params: {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  accountEmail?: string | null;
  model?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<T> {
  const payload = await callResponses({
    model: params.model ?? openAIModel('primary'),
    instructions: params.instructions,
    input: [{ role: 'user', content: [{ type: 'input_text', text: params.input }] }],
    reasoning: { effort: 'low' },
    max_output_tokens: params.maxOutputTokens ?? 1200,
    safety_identifier: safetyIdentifier(params.accountEmail),
    text: {
      format: {
        type: 'json_schema',
        name: params.schemaName,
        strict: true,
        schema: params.schema,
      },
    },
  }, params.timeoutMs ?? 35_000);
  const text = outputText(payload);
  if (!text) throw new Error('OpenAI returned no structured output');
  return JSON.parse(text) as T;
}

export async function openAIText(params: {
  instructions: string;
  input: string;
  accountEmail?: string | null;
  model?: string;
  maxOutputTokens?: number;
  webSearch?: boolean;
  timeoutMs?: number;
}): Promise<string> {
  const payload = await callResponses({
    model: params.model ?? openAIModel('primary'),
    instructions: params.instructions,
    input: [{ role: 'user', content: [{ type: 'input_text', text: params.input }] }],
    reasoning: { effort: 'low' },
    max_output_tokens: params.maxOutputTokens ?? 2600,
    safety_identifier: safetyIdentifier(params.accountEmail),
    text: { verbosity: 'medium' },
    ...(params.webSearch ? { tools: [{ type: 'web_search' }] } : {}),
  }, params.timeoutMs ?? 45_000);
  const text = outputText(payload);
  if (!text) throw new Error('OpenAI returned no text output');
  return text;
}

