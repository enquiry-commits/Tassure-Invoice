-- Split the 3 generic ar/soa/letter templates into 6 named ones matching
-- the original BULK.xlsm sheets (List_letter, AR1, AR2, AR3, SOA1, SOA2).
-- Campaign Centre already lists every template under a type in its
-- dropdown, so this needs no schema/API change — just better-named,
-- more specific default content per real scenario.
--
-- Run ONCE in the Supabase SQL editor. Idempotent — safe to re-run.

-- Rename the existing generic AR default -> AR1 (single-invoice renewal,
-- the most common case — 68 of the 95 historical AR rows were this shape).
update email_templates
set name = 'AR1 - Standard Renewal',
    subject_template = 'Corporate Secretarial Services Renewal - {{companyName}}',
    body_template = E'Dear {{contactName}},\n\nPlease find attached the renewal invoice for {{companyName}}:\n\n{{invoiceList}}\n\nTotal amount due: S${{totalAmount}}\n\nKindly arrange payment at your earliest convenience.\n\nThank you.'
where type = 'ar' and is_default = true
  and name = 'AR Renewal Reminder (default)';

-- Rename the existing generic SOA default -> SOA1.
update email_templates
set name = 'SOA1 - Statement of Account',
    subject_template = 'Statement of Account - {{companyName}}',
    body_template = E'Dear {{contactName}},\n\nPlease find below the outstanding invoices for {{companyName}}:\n\n{{invoiceList}}\n\nTotal outstanding: S${{totalAmount}}\n\nKindly settle at your earliest convenience.\n\nThank you.'
where type = 'soa' and is_default = true
  and name = 'Statement of Account (default)';

-- AR2: multi-invoice renewal (a company owing across several invoices/QB
-- companies at once — the original sheet had up to 3 invoice-number slots).
insert into email_templates (type, name, subject_template, body_template, is_default)
select 'ar', 'AR2 - Multi-Invoice Renewal',
  'Corporate Secretarial Services Renewal - {{companyName}} (Multiple Invoices)',
  E'Dear {{contactName}},\n\nPlease find attached the renewal invoices for {{companyName}}:\n\n{{invoiceList}}\n\nTotal amount due: S${{totalAmount}}\n\nKindly arrange payment for all invoices at your earliest convenience.\n\nThank you.',
  false
where not exists (select 1 from email_templates where type = 'ar' and name = 'AR2 - Multi-Invoice Renewal');

-- AR3: same shape as AR1 in the original workbook (single <INV> column) —
-- kept as a separate named template since staff maintained it as its own
-- sheet/batch, not merged into AR1.
insert into email_templates (type, name, subject_template, body_template, is_default)
select 'ar', 'AR3 - Renewal (Batch)',
  'Corporate Secretarial Services Renewal - {{companyName}}',
  E'Dear {{contactName}},\n\nPlease find attached the renewal invoice for {{companyName}}:\n\n{{invoiceList}}\n\nTotal amount due: S${{totalAmount}}\n\nKindly arrange payment at your earliest convenience.\n\nThank you.',
  false
where not exists (select 1 from email_templates where type = 'ar' and name = 'AR3 - Renewal (Batch)');

-- SOA2: same shape as SOA1 in the original workbook, kept separate for the
-- same reason as AR3 above.
insert into email_templates (type, name, subject_template, body_template, is_default)
select 'soa', 'SOA2 - Statement of Account (Batch)',
  'Statement of Account - {{companyName}}',
  E'Dear {{contactName}},\n\nPlease find below the outstanding invoices for {{companyName}}:\n\n{{invoiceList}}\n\nTotal outstanding: S${{totalAmount}}\n\nKindly settle at your earliest convenience.\n\nThank you.',
  false
where not exists (select 1 from email_templates where type = 'soa' and name = 'SOA2 - Statement of Account (Batch)');
