-- Vincent, 2026-08-20: one-off test row for verifying Draft Helper 1.5.8's
-- fixed sent-item reconciler. Fully synthetic — fake company, addressed
-- only to your own inbox (vincenttassure@outlook.com), never touches real
-- QuickBooks or real client data.

WITH new_campaign AS (
  INSERT INTO email_campaigns (type, name, status)
  VALUES ('ar', 'TASSURE TEST - Draft Helper 1.5.8 verification (safe to ignore)', 'draft')
  RETURNING id
)
INSERT INTO email_drafts (campaign_id, company_name, to_email, subject, body, invoice_refs, status)
SELECT
  new_campaign.id,
  'TASSURE TEST COMPANY PTE. LTD.',
  'vincenttassure@outlook.com',
  'TASSURE TEST - Draft Helper 1.5.8 verification (safe to ignore)',
  'This is a one-off test email for verifying automatic sent-detection. Safe to ignore/delete.',
  '[]'::jsonb,
  'pending'
FROM new_campaign
RETURNING id, campaign_id, company_name, status;

-- ↑ Copy the "id" from the result — that's the draft id Claude needs to run the test.

-- Cleanup after the test (replace <DRAFT_ID>, <CAMPAIGN_ID> with the values above):
-- DELETE FROM email_drafts WHERE id = <DRAFT_ID>;
-- DELETE FROM email_campaigns WHERE id = <CAMPAIGN_ID>;
