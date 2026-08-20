-- Vincent, 2026-08-19: stop trying to resolve a specific contact person's
-- name for the AR renewal greeting (often falls back to the company name
-- itself when no real contact is on file, e.g. "Dear Beltroad International
-- Investment Consulting Pte. Ltd.,") — use one generic greeting for every
-- AR email instead. Applies to all 3 AR templates (AR1/AR2/AR3), which all
-- currently open with the same "Dear {{contactName}}," line.
UPDATE email_templates
SET body_template = replace(body_template, 'Dear {{contactName}},', 'Dear Valued Clients,')
WHERE type = 'ar';
