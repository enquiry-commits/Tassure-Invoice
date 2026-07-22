import assert from 'node:assert/strict';
import {
  applyCampaignRecipientRules,
  normalizeRecipientLines,
  parseEmailList,
} from '../lib/campaign-recipients.ts';

assert.deepEqual(
  parseEmailList('CLIENT@EXAMPLE.COM<br> finance@example.com; client@example.com'),
  ['client@example.com', 'finance@example.com'],
);

assert.deepEqual(
  applyCampaignRecipientRules([
    'client@example.com',
    'cindy@tassure.com',
    'sengxin@tassure.com',
    'shiming@tassure.com',
  ]),
  {
    toEmails: ['client@example.com'],
    ccEmails: ['hoechyi@tassure.com', 'sengxin@tassure.com', 'shiming@tassure.com'],
  },
);

assert.deepEqual(
  applyCampaignRecipientRules([
    'first@customer.com',
    'second@customer.com',
    'kahye@tassure.com',
    'sengxin@tassure.com',
    'staff@tasure.com',
  ]),
  {
    toEmails: ['first@customer.com', 'second@customer.com'],
    ccEmails: ['hoechyi@tassure.com', 'kahye@tassure.com', 'staff@tasure.com'],
  },
);

assert.equal(
  normalizeRecipientLines('one@example.com, two@example.com\nONE@example.com'),
  'one@example.com\ntwo@example.com',
);

console.log('Campaign recipient rules: all tests passed.');
