-- Vincent (2026-09-11): "可以继续深入" — three more source documents
-- supplied, each rich in PROCESS detail rather than pricing:
--   - "Services_proposal_takeover_strike_off.pdf" — real Strike Off
--     Gazette-notification timeline, PLUS two real required fees
--     (account/tax clearance) never captured before.
--   - "EP______.pdf" (undated) — a full flowchart for what happens AFTER
--     an EP is approved: activation methods, required documents, the
--     physical EPSC visit, and post-activation payroll/SDL obligations.
--   - "____TASSURE_2026_V1.pdf" (undated) — the Trade Mark application's
--     4-step process and IPOS timeline (4-6 months review + 2 months
--     publication = 6-8 months total, 10-year validity).
-- This script ENRICHES existing rows' descriptions (appending real
-- process detail, never discarding what was already there) and adds two
-- genuinely new fee rows. It deliberately does NOT touch the Trade Mark
-- row's price: this new document states SGD 1,000/class (+SGD 500 per
-- extra class), which conflicts with the 11 Sep 2026 proposal's SGD
-- 900/class (+SGD 400) already in the table, and neither of these three
-- new documents carries a visible date to judge recency by — flagged in
-- this row's remarks rather than silently picked, pending Vincent's call.
-- Safe to run more than once (upserts by the same natural key as
-- scripts/add-service-pricing.sql).

-- NOTE (2026-09-11): Vincent's first run of this script silently no-opped
-- on this exact UPDATE — root cause found after the fact: PC7-a/PC7-b's
-- description_en/description_cn started as NULL (see scripts/add-service-
-- pricing.sql), and `NULL || any_text` evaluates to NULL in PostgreSQL, so
-- the concatenation quietly produced NULL instead of erroring. The live
-- data was already hand-corrected via a direct Supabase REST API PATCH
-- (bypassing the SQL editor entirely) rather than asking for a third
-- re-run — do NOT re-run this statement against that already-fixed data,
-- the WHERE guard below would just no-op again (correctly, this time)
-- since the marker text is already present. Fixed here with COALESCE +
-- an idempotency guard so this script is safe if ever replayed on a FRESH
-- environment where these rows still start NULL.
UPDATE public.service_pricing
SET
  description_en = COALESCE(description_en, '') || E'\n\nStrike Off Process (Gazette Notification Timeline): Once the striking off application is approved, ACRA may send a striking off notice to the company''s registered office address and to its officers (director, company secretary, shareholder) at their address on record. After 30 days from approval, if there is no objection, ACRA publishes the company''s name in the Government Gazette (the "First Gazette Notification"). After a further 60 days from the First Gazette Notification, if there is still no objection, ACRA publishes the name again and the company is struck off the register, with the strike-off date stated (the "Final Gazette Notification"). The realistic total cost of a striking off engagement also includes Account and Tax Clearance (see the separate fee rows in this section) — budget from SGD 1,400 total, not just the SGD 600 application fee alone.',
  description_cn = COALESCE(description_cn, '') || E'\n\n注销流程（政府公报通知时间表）：注销申请获批后，ACRA 可能会向公司注册地址及其管理人员（董事、公司秘书、股东）在我们记录中的地址发送注销通知。获批30天后，如无异议，ACRA 将在政府公报上公布公司名称（"第一份公报通知"）。自第一份公报通知起再过60天，如仍无异议，ACRA 将再次公布公司名称并将其从登记册中删除，同时注明注销日期（"最终公报通知"）。一次完整的注销服务实际总费用还包括账目和税务清算（见本区其他费用项）——请预留至少SGD 1,400 的总预算，而不是只算SGD 600 的注销申请费。',
  remarks_en = 'Process detail from "Services_proposal_takeover_strike_off.pdf" (date not printed on the document — captured 11 Sep 2026, the day Vincent supplied it).',
  remarks_cn = '流程说明来自"Services_proposal_takeover_strike_off.pdf"（文件本身未印刷日期——于2026年9月11日Vincent提供当天录入）。',
  updated_at = now()
WHERE section = 'Post-Incorporation Changes — Striking Off' AND item_code IN ('PC7-a', 'PC7-b')
  AND (description_en IS NULL OR description_en NOT LIKE '%Gazette Notification Timeline%');

UPDATE public.service_pricing
SET
  description_en = COALESCE(description_en, '') || E'\n\nPost-approval activation process: Method A (recommended) — the secretary submits documents online, then books a Ministry of Manpower (MOM) appointment for in-person activation — appointment slots are relatively plentiful, and the MOM visit itself takes only around 30 minutes, but this requires entering Singapore first and staying a few days (recommend budgeting a week, at least 3 working days). Method B — book a MOM appointment for in-person submission AND activation directly, which can be done before entering Singapore if a slot is available, but slots are scarce (book at least 1 month ahead), the MOM visit itself takes about 2 hours, and MOM may query why the applicant is submitting in person rather than through the secretary''s online channel. Either way, the applicant must supply the secretary with: a scanned copy of the signed page of the EP approval letter, a genuine long-term Singapore residential address (not a hotel — e.g. HDB or condo, with the property owner adding the applicant''s name at MOM''s TES e-service), and (if available) a local Singapore mobile number — the applicant must also submit the SG Arrival Card electronically within 72 hours before entry. On the appointment date, the applicant attends the Employment Pass Services Centre (EPSC) in person — The Riverwalk, 20 Upper Circular Road, #04-01/02, Singapore 058416 — bringing the Local Director declaration form, Pass Holder declaration form, EA declaration form (provided by the secretary), passport, and appointment/notification letter. The physical EP card is ready around 5 working days after activation. Once the EP card is activated (activation date = employment start date), the company must begin monthly salary payment and payslip issuance, and submit the Skills Development Levy (SDL, SGD 11.25/month, payable half-yearly if there is no local employee) — the EP holder does not need CPF contributions.',
  description_cn = COALESCE(description_cn, '') || E'\n\n批准后的激活流程：方式A（推荐）——秘书公司网上提交材料，再预约人力部（MOM）时间到现场激活；可预约时间段相对充足，MOM现场仅需约30分钟，但需要先入境新加坡并停留几天（建议安排一周，最少3个工作日）。方式B——直接预约人力部现场提交材料并激活，入境海关前即可预约（如有空位），但可预约时间段很少（需至少提前1个月确定日期），MOM现场需约2小时，且MOM可能会现场追问为何选择现场提交（MOM更倡导由秘书公司网上提交）。无论哪种方式，申请人都必须提供给秘书公司：EP批准信中签字页的扫描件、新加坡本地长期有效居住地址（非酒店，如HDB或公寓，需屋主通过MOM的TES线上服务把申请人名字加入该地址名下）、以及（如有）新加坡本地手机号码；入境前72小时内还须提交电子入境卡。在预约的日期和时间，申请人须亲自前往Employment Pass Services Centre（EPSC）——地址：The Riverwalk, 20 Upper Circular Road, #04-01/02, Singapore 058416——并携带本地董事声明表、准证持有人声明表、EA声明表（秘书代理提供）、护照及预约/通知信。激活后约5个工作日，实体卡即可领取。一旦EP卡被激活（激活日期即为入职日期），公司须开始每月支付工资并准备工资单，同时提交技能发展税（SDL，每月SGD 11.25，若无本地员工可每半年缴纳一次）——EP持有人不需要缴纳公积金（CPF）。',
  updated_at = now()
WHERE section = 'First-Year Package' AND item_code = 'T1-6'
  AND (description_en IS NULL OR description_en NOT LIKE '%Post-approval activation process%');

-- Vincent confirmed (2026-09-11, in chat): go with SGD 1,000 per class plus
-- SGD 500 per additional class, over the 11 Sep proposal's SGD 900 / +SGD
-- 400. The live row was already hand-corrected via a direct Supabase REST
-- API PATCH once it became clear this statement's price fields hadn't
-- taken effect on the first run (see the note above the Striking Off
-- UPDATE) — this version matches what's already live — the WHERE guard
-- below makes re-running it a safe no-op rather than a duplicate append.
UPDATE public.service_pricing
SET
  description_en = COALESCE(description_en, '') || E'\n\nApplication process: (1) select and confirm the goods/services class(es) (Tassure provides a goods/services classification reference) — (2) supply the logo/wordmark as a JPG (tell Tassure if applying for a series of marks) — (3) Tassure searches the Singapore trade mark register for existing identical/similar marks, particularly within the applicant''s own business area — (4) file the application — the goods/services listed must conform to the international goods/services classification. After filing, IPOS takes 4-6 months to examine the application, followed by a 2-month publication period — if there is no opposition, the mark proceeds to registration and a certificate is issued. A registered mark is valid for 10 years and can be renewed. The whole process typically takes about 6-8 months when it goes smoothly.',
  description_cn = COALESCE(description_cn, '') || E'\n\n申请流程：1）选择并确认商品/服务类别（Tassure提供商品/服务分类参考文件）；2）提供jpg格式的Logo/文字（如希望申请一系列商标，请告知Tassure）；3）在新加坡商标注册局记录中搜索现有相同或相似商标，尤其是在申请人自己的业务领域内；4）提交申请——申请中列出的商品和服务须符合国际商品和服务分类。提交申请后，IPOS需要4-6个月审核，审核后进入2个月的公示（Publication）阶段；如无任何异议，商标将完成注册并获得注册证书。商标有效期为十年，之后可以续展。顺利的话，整个过程大概需要6-8个月。',
  price_display = 'SGD 1,000.00',
  price_sgd_min = 1000,
  price_sgd_max = 1000,
  remarks_en = 'Extra SGD 500 per additional class. Confirmed by Vincent (11 Sep 2026) as the authoritative figure, superseding the earlier SGD 900 (+SGD 400) from the client proposal.',
  remarks_cn = '每多一个类别，另加$500。Vincent已确认（2026年9月11日）以此为准，取代此前客户提案中900新币（+400新币）的数字。',
  source_document = '____TASSURE_2026_V1.pdf (price confirmed by Vincent 2026-09-11)',
  updated_at = now()
WHERE section = 'Post-Incorporation Changes — Trade Mark' AND item_code = 'PC5-a'
  AND (description_en IS NULL OR description_en NOT LIKE '%Application process: (1)%');

INSERT INTO public.service_pricing
  (section, item_code, service_name_en, service_name_cn, description_en, description_cn, price_display, price_sgd_min, price_sgd_max, price_unit, quote_required, is_foc, remarks_en, remarks_cn, is_total, display_order, source_document, source_updated_on)
VALUES
('Post-Incorporation Changes — Striking Off', 'PC7-c', 'Account and Tax Clearance Fee', '清账目费用',
 $$- Clearing the company's outstanding accounts as part of the striking off process — a real prerequisite ACRA/IRAS expect before a company can be struck off, not an optional add-on.$$,
 $$- 作为注销流程的一部分，清理公司的账目——这是ACRA/IRAS在公司可以被注销前实际要求的前置条件，不是可选附加项。$$,
 'From SGD 500.00', 500, null, 'one-time (varies with transaction volume)', false, false,
 'Fee may change based on the volume of account transactions.', '费用可能根据账目交易量而有所变动。', false, 65,
 'Services_proposal_takeover_strike_off.pdf', '2026-09-11'),

('Post-Incorporation Changes — Striking Off', 'PC7-d', 'Tax Clearance Fee', '税务清算费用',
 $$- Obtaining tax clearance from IRAS as part of the striking off process.$$,
 $$- 作为注销流程的一部分，向新加坡税务局（IRAS）办理税务清算。$$,
 'From SGD 300.00', 300, null, 'one-time (varies with transaction volume)', false, false,
 'Fee may change based on the volume of account transactions. Realistic total for a full striking off engagement (application + account clearance + tax clearance): From SGD 1,400.',
 '费用可能根据账目交易量而有所变动。一次完整注销服务（注销申请+账目清算+税务清算）的实际总费用参考：从SGD 1,400起。', false, 66,
 'Services_proposal_takeover_strike_off.pdf', '2026-09-11')

ON CONFLICT (section, item_code, service_name_en) DO UPDATE SET
  service_name_cn = EXCLUDED.service_name_cn,
  description_en = EXCLUDED.description_en,
  description_cn = EXCLUDED.description_cn,
  price_display = EXCLUDED.price_display,
  price_sgd_min = EXCLUDED.price_sgd_min,
  price_sgd_max = EXCLUDED.price_sgd_max,
  price_unit = EXCLUDED.price_unit,
  quote_required = EXCLUDED.quote_required,
  is_foc = EXCLUDED.is_foc,
  remarks_en = EXCLUDED.remarks_en,
  remarks_cn = EXCLUDED.remarks_cn,
  is_total = EXCLUDED.is_total,
  display_order = EXCLUDED.display_order,
  source_document = EXCLUDED.source_document,
  source_updated_on = EXCLUDED.source_updated_on,
  updated_at = now();
