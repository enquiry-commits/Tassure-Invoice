import assert from 'node:assert/strict';
import { detectActivityPatterns } from '../lib/ai-learning/patterns.ts';

const now = new Date('2026-09-08T12:00:00.000Z');
const email = 'vincent@tassure.com';
let id = 0;
const event = (createdAt, eventType, pathname = '/billing', detail = null, accountEmail = email) => ({
  id: ++id,
  account_email: accountEmail,
  pathname,
  event_type: eventType,
  detail,
  created_at: createdAt,
});

const pageEvents = [
  event('2026-09-01T01:00:00Z', 'page_view'),
  event('2026-09-01T01:05:00Z', 'page_view'), // same 30-minute session: collapsed
  event('2026-09-01T03:00:00Z', 'page_view'),
  event('2026-09-02T01:00:00Z', 'page_view'),
  event('2026-09-03T01:00:00Z', 'page_view'),
  event('2026-09-04T01:00:00Z', 'page_view'),
  event('2026-09-04T03:00:00Z', 'page_view'),
  event('2026-09-05T01:00:00Z', 'page_view'),
  event('2026-09-05T03:00:00Z', 'page_view'),
];
const pagePatterns = detectActivityPatterns(pageEvents, { accountEmail: email, now });
assert.equal(pagePatterns.length, 1);
assert.equal(pagePatterns[0].pattern_kind, 'frequent_page');
assert.equal(pagePatterns[0].source_count, 8);
assert.equal(pagePatterns[0].evidence.raw_count, 9);
assert.equal(pagePatterns[0].distinct_days, 5);
assert.equal(pagePatterns[0].recommended_status, 'ready_for_review');
assert.match(pagePatterns[0].proposed_content, /^Repeatedly visits/);

const actionEvents = [
  event('2026-09-01T02:00:00Z', 'create_outlook_drafts', '/client-communications/campaigns', { companyName: 'A' }),
  event('2026-09-01T02:05:00Z', 'create_outlook_drafts', '/client-communications/campaigns', { companyName: 'B' }),
  event('2026-09-02T02:00:00Z', 'create_outlook_drafts', '/client-communications/campaigns', { companyName: 'C' }),
  event('2026-09-02T02:05:00Z', 'create_outlook_drafts', '/client-communications/campaigns', { companyName: 'D' }),
  event('2026-09-03T02:00:00Z', 'create_outlook_drafts', '/client-communications/campaigns', { companyName: 'E' }),
  event('2026-09-03T02:05:00Z', 'create_outlook_drafts', '/client-communications/campaigns', { companyName: 'F' }),
];
const actionPatterns = detectActivityPatterns(actionEvents, { accountEmail: email, now });
assert.equal(actionPatterns.length, 1);
assert.equal(actionPatterns[0].pattern_kind, 'frequent_action');
assert.equal(actionPatterns[0].recommended_status, 'ready_for_review');
assert.equal(actionPatterns[0].source_count, 6);
assert.equal(actionPatterns[0].evidence.sample_details?.length, 5);

const tooLittleEvidence = detectActivityPatterns(pageEvents.slice(0, 3), { accountEmail: email, now });
assert.deepEqual(tooLittleEvidence, []);

const excluded = detectActivityPatterns([
  ...pageEvents,
  event('2025-01-01T00:00:00Z', 'page_view'),
  event('2026-09-03T01:00:00Z', 'page_view', '/billing', null, 'other@tassure.com'),
], { accountEmail: email, now });
assert.equal(excluded[0].evidence.raw_count, 9);

console.log('AI learning pattern checks passed.');
