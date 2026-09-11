-- Vincent (2026-09-11): standard service catalog + pricing, so the system
-- (and later the AI assistant) has real service/pricing data to reference
-- instead of guessing. Two source documents were supplied:
--   - "proposal_cost_Standard_2026_V2026.0226.pdf" (26 Feb 2026) — a plain
--     standard price sheet.
--   - "Tassure_Proposal__20260911001.docx" (11 Sep 2026) — a full client
--     proposal: richer prose service descriptions PLUS three pricing
--     tables PLUS an entire "post-incorporation changes" fee schedule the
--     Feb sheet never had at all.
-- Vincent's explicit instruction where the two disagreed on a number
-- (confirmed real differences: EP application $5,000 vs $4,000, EP renewal
-- $1,500 vs $1,800/every 2 years, DP renewal $500 vs $600/every 2 years,
-- personal tax filing $400/individual vs $300/year incl. Singpass setup):
-- "数字以9月11日的为准，然后内容可以分析两边的内容和描述" — the 11 Sep
-- proposal's NUMBERS are authoritative throughout this script — service
-- DESCRIPTIONS were synthesized from both documents where they overlap
-- (they mostly restate each other) and from the 11 Sep proposal alone
-- where only it has the content (the whole post-incorporation schedule,
-- Payment Terms, General terms).
--
-- This is STANDARD / LIST price reference data only — never the source of
-- truth for what a real client is actually billed (that stays
-- QuickBooks/generated_invoices — real client agreements, discounts, and
-- packages can and do differ, as this proposal's own "Goodwill Discount"
-- line shows). Do not wire this into any billing calculation — it is
-- read-only reference data for understanding the business.
-- Safe to run more than once in Supabase SQL Editor (upserts by natural key).

CREATE TABLE IF NOT EXISTS public.service_pricing (
  id bigserial PRIMARY KEY,
  section text NOT NULL,               -- e.g. 'First-Year Package', 'Ongoing Maintenance (From Year 2)', 'Post-Incorporation Changes — Share Issue & Transfer'
  item_code text,                      -- e.g. 'T1-1' (Table 1 row 1), 'PC1-a' (Post-incorp changes group 1, sub-item a)
  service_name_en text NOT NULL,
  service_name_cn text,
  description_en text,                 -- prose/bullets, synthesized from both source docs where they overlap
  description_cn text,
  price_display text NOT NULL,         -- human-readable as printed, e.g. "SGD 900", "SGD 600–1,000", "F.O.C. (included in package)"
  price_sgd_min numeric,               -- null when quote_required, FOC, or not a fixed number
  price_sgd_max numeric,               -- equals price_sgd_min unless the source prints a range
  price_unit text,                     -- 'one-time', 'per year', 'per EP', 'per applicant', 'per set', etc.
  quote_required boolean NOT NULL DEFAULT false,
  is_foc boolean NOT NULL DEFAULT false,   -- free of charge / included in a package
  remarks_en text,
  remarks_cn text,
  is_total boolean NOT NULL DEFAULT false,  -- true for the sheet's own printed Subtotal/Total rows
  display_order integer NOT NULL,
  source_document text NOT NULL,
  source_updated_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section, item_code, service_name_en)
);

-- Company policy / terms text that isn't a priced line item, but is real
-- business knowledge worth the assistant having (payment terms, contract
-- terms, confidentiality) — kept separate from service_pricing on purpose,
-- since forcing prose-only rows into a pricing table would be awkward.
CREATE TABLE IF NOT EXISTS public.company_service_terms (
  id bigserial PRIMARY KEY,
  topic text NOT NULL,
  content_en text NOT NULL,
  content_cn text,
  display_order integer NOT NULL,
  source_document text NOT NULL,
  source_updated_on date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic)
);

INSERT INTO public.service_pricing
  (section, item_code, service_name_en, service_name_cn, description_en, description_cn, price_display, price_sgd_min, price_sgd_max, price_unit, quote_required, is_foc, remarks_en, remarks_cn, is_total, display_order, source_document, source_updated_on)
VALUES

-- ===================== Table 1: Company Incorporation and First-Year Service Fees =====================
('First-Year Package', 'T1-1', 'Company Incorporation Service', '公司注册服务',
 $$- Company KYC and background checks for all directors and shareholders
- Name application and Company registration including all government fees
- Company related consultations
- Company standard constitution
- Company Business profile (Bizfile)
- Preparation of First Board Meeting Minutes and Resolutions and related forms
- Company self-ink stamp
- Share Certificates
- Company Registers and other post-incorporation documents
- Register of Controller and updates with government$$,
 $$- 客户背景调查和尽职调查（全体董事和股东）
- 公司名字申请和成立（包括政府费用$315）
- 公司相关咨询
- 公司章程（标准章程）
- 公司信息纸（Bizfile）
- 第一次股东大会决议文件和相关董事决议文件（涵盖其他公司设立相关文件）
- 公司章
- 股份证书
- 公司注册簿和其他公司注册后文件
- 受益人申报$$,
 'SGD 900.00', 900, 900, 'one-time', false, false, null, null, false, 1,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', 'T1-2', 'Corporate Secretarial Services — Yearly', '公司法定秘书服务（年费）',
 $$- Safe custody of statutory records (minute files and statutory registers: shareholders, directors and secretaries, transfers, charges, etc.)
- Preparing all documentation for the routine AGM as required by the Singapore Companies Act 1967
- Preparing and submitting the prescribed Annual Return to ACRA
- Drafting routine resolutions (bank account opening/closing, appointment/resignation of company secretary, change of registered address, etc.)
- Liaison with auditors/accountants for statutory review of corporate secretarial records where applicable
- Ad hoc requests: EGM, allotment of shares, transfer of shares, alteration of M&AA, conversion of financial statements to XBRL for ACRA filing, etc. (additional fees vary by complexity)
- Named as company secretary (Tassure's CPA secretary is named in ACRA Bizfile)
- Important-date reminders during the year
- Government updates/compliance notifications (e.g. Register of Controllers & KYC)$$,
 $$- 秘书档案建立和管理
- 根据《新加坡公司法1967》准备年度股东大会文件
- 提交年检
- 配合公司发展需要准备相应的董事决议（开户/关户、更换秘书、更改注册地址等）
- 如若公司有审计要求，配合联系审计师或会计师安排审核秘书文件
- 应特别要求：EGM、股份分配、股份转让、章程变更、XBRL格式财务报表转换等（附加费用视情况而异）
- 担任公司秘书（注册秘书名字将显示在公司注册纸）
- 公司重要日期提醒
- 政府条例和信息更新/咨询（如受益人申报KYC）$$,
 'SGD 700.00', 700, 700, 'per year', false, false, null, null, false, 2,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', 'T1-3', 'Corporate Bank Account Opening Support', '企业银行账户开户协助',
 $$- Bank resolution preparation — included in the incorporation service.
- Assisting with bank opening, including introducing different banks (UOB/OCBC/Standard Chartered/CIMB/DBS) and helping with preliminary assessment.
- Or, with the client's own bank relationships, support on bank opening will be provided.$$,
 $$- 开户董事决议文件准备/开户协助，服务涵盖在开设公司服务内。
- 如果只是基本户，没有其他银行费用；开户决议我们会准备并安排初步审核不同银行（UOB/OCBC/Standard Chartered/CIMB/DBS）。
- 我们也会对接客户自己委任的银行开户经理，做开户的支持。$$,
 'SGD 1,000.00', 1000, 1000, 'one-time', false, false, null, null, false, 3,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', 'T1-4', 'Registered Office and Mailing Address Services — Yearly', '公司注册地址及收信服务（年费）',
 $$- Registered address.
- Mail checking/collection/scanning/emailing, and postage or courier arrangement upon request.$$,
 $$- 公司注册使用地址。
- 收信服务/扫描/邮件信件，根据客户要求安排邮递或快递（如需）。$$,
 'SGD 360.00', 360, 360, 'per year', false, false, null, null, false, 4,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', 'T1-5', 'Local Nominee Director Service — Yearly', '本地挂名董事服务（年费）',
 $$- Being named local director in ACRA — a local Singaporean director is provided, with no operational involvement.
- Detailed terms refer to the Nominee Director Agreement drafted and finalized by Tassure's lawyer.
- Lawyer review and consultation on the agreement is available where the client has special conditions or requirements, based on mutual agreement.$$,
 $$- 在公司注册局上显示本地董事，以符合公司法基本要求，不涉及公司运营。
- 详细参考律师草拟的《挂名董事协议》。
- 如客户在相互协议的基础上有特殊条件或要求，还可以对协议进行律师审查和咨询。$$,
 'SGD 3,000.00', 3000, 3000, 'per year', false, false, null, null, false, 5,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', 'T1-5D', 'Local Nominee Director — Additional Deposit', '本地挂名董事 — 另付押金',
 null, null, 'SGD 3,000.00', 3000, 3000, 'one-time (refundable)', false, false,
 'Refundable once the client obtains their own local director (e.g. after EP approval).',
 'EP申请下来或有自己的本地董事人选后可退还。', false, 6,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', 'T1-6', 'Employment Pass (EP) Application Service', '就业准证（EP）申请服务',
 $$- Assisting the Company and/or applicant with the EP application process, including preliminary eligibility assessment and advisory, review and preparation of supporting documents, submission of EP application to MOM, posting of job advertisements where required, liaison with relevant authorities, submission of additional documents or appeals where necessary, and administrative support until issuance of the In-Principle Approval (IPA) letter and receipt of the EP card.
- Related corporate administrative coordination and advisory support in connection with the EP application process is also provided where applicable.$$,
 $$- 协助办理EP申请，包括申请资格初步评估及咨询、审核及准备相关申请文件、向MOM提交申请、按要求发布招聘广告（如需）、与相关政府机构沟通、在需要时提交补充文件或上诉，并提供行政支持直至获得原则性批准函及领取EP卡。
- 也会就EP申请相关事宜提供企业行政协调及咨询支持服务（如需）。$$,
 'SGD 4,000.00', 4000, 4000, 'one-time', false, false,
 'This proposal''s bundled first-EP price. A standalone Feb 2026 price sheet had quoted SGD 5,000 for this same first-EP application — treat this 11 Sep figure as current per Vincent''s instruction.',
 '本提案打包价。2026年2月的独立价格表曾报价$5,000（第一个EP申请）——按Vincent指示，以此9月11日数字为准。',
 false, 7, 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', 'T1-7', 'One-Time Post-EP Changes', 'EP获批后一次性政府记录更新',
 $$- Update of personal particulars.
- Resignation of local Nominee Director.$$,
 $$- 个人信息更新。
- 本地挂名董事辞任。$$,
 'F.O.C. (included in package)', null, null, 'one-time', false, true, null, null, false, 8,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', 'T1-8', 'CorpPass Account Registration', '企业通行证（CorpPass）账号开通',
 $$- CorpPass is Singapore's official corporate digital identity platform, allowing companies and authorised users to access and transact with Singapore government agencies electronically.
- Assisting the Company with the application, registration, set-up, and activation of the Company's CorpPass account, including administrator/user setup.$$,
 $$- CorpPass是新加坡政府官方企业数字身份平台，用于公司授权用户及办理各类政府机构电子服务。
- 协助公司申请、注册、设立及启用CorpPass账户，包括管理员/用户设置权限等。$$,
 'F.O.C. (included in package)', null, null, 'one-time', false, true, null, null, false, 9,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', 'T1-9', 'PDPA Compliance — DPO Appointment & Policy Documentation', '个人资料保护法（PDPA）合规 — 数据保护官任命及政策文件',
 $$- Appointment of DPO (Data Protection Officer) and notice/policy generation. An additional fee will be incurred if extra documentation work is required beyond the standard scope.$$,
 $$- 任命数据保护官（DPO）以及生成相关的通知/政策文档；超出标准范围的额外文件工作会产生附加费用。$$,
 'F.O.C. (included in package)', null, null, 'one-time', false, true, null, null, false, 10,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', 'T1-10', 'Corporate Consultation Support', '企业咨询支持',
 null, null, 'F.O.C. (included in package)', null, null, null, false, true, null, null, false, 11,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', 'T1-11', 'Purchase of Certificate of Incorporation', '购买公司注册证书',
 null, null, 'SGD 100.00', 100, 100, 'one-time', false, false, null, null, false, 12,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', 'T1-12', 'Dependant''s Pass (DP) Application', '家属准证申请',
 $$- DP refers to a pass issued by MOM to eligible family members of Employment Pass or S Pass holders residing in Singapore.
- Assisting with the DP application process: review and preparation of supporting documents, submission to MOM, liaison with relevant authorities, submission of additional documents where required, and administrative support until issuance of the IPA letter and receipt of the DP card.$$,
 $$- 家属准证是由新加坡人力部签发给符合资格的EP或S Pass持有人的家属、居留在新加坡的准证。
- 协助办理DP申请程序，包括审核及准备相关申请文件、向MOM提交DP申请、与相关政府机构沟通、在需要时提交补充文件，并提供行政支持直至获得原则性批准函（IPA）及领取DP准证卡。$$,
 'SGD 600.00 per person', 600, 600, 'per applicant', false, false, null, null, false, 13,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', 'T1-13', 'Letter of Consent (LOC) Application', '工作许可同意书（LOC）申请',
 $$- LOC for Secondary Directorship is the formal authorization granted by MOM allowing an EP holder to be appointed as a director in a related or investment-linked entity, ensuring compliance with the Employment of Foreign Manpower Act.
- Assisting with the LOC application: assessment of corporate nexus and eligibility, reviewing supporting documents (e.g. Board Resolutions from both the primary employer and the secondary entity), submission to MOM, liaison with relevant authorities, and administrative support until formal issuance of the LOC.$$,
 $$- 兼任董事工作许可同意书（LOC）是由MOM签发的正式授权，允许EP持有人在关联公司或具有投资关系的实体中担任董事职务，确保任命符合《雇佣外国人力法令》。
- 协助办理LOC申请，包括评估公司关联性及申请资格、审核法定证明文件（如主雇主及兼职实体双方的董事会决议）、提交申请、并提供行政支持直至LOC正式签发。$$,
 'SGD 200.00 per person', 200, 200, 'per applicant', false, false, null, null, false, 14,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', null, 'Goodwill Discount', '折扣-整体配套',
 null, null, 'SGD 0.00', 0, 0, null, false, false,
 'Printed as SGD 0.00 in this specific proposal — a discount line exists in the template but was not applied here — real client proposals may carry a nonzero value.',
 '本次提案中此项为$0.00——折扣栏位存在于模板中但本次未使用；实际给客户的提案可能会有非零折扣。', false, 15,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('First-Year Package', null, 'First-Year Package Total', '设立和第一年服务费用 总计',
 null, null, 'SGD 13,860.00', 13860, 13860, 'one-time (first year)', false, false,
 'Includes the SGD 3,000 nominee director deposit.',
 '含挂名董事押金SGD 3,000。', true, 16,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

-- ===================== Table 2: Indicative Fees for Ongoing Company Maintenance Services =====================
('Ongoing Maintenance (From Year 2)', 'T2-1', 'Accounts Preparation — Yearly', '年度做账服务',
 $$- Data processing of transactions based on client records and supporting documents.
- Preparing management reports (Trial Balance, Balance Sheet, Profit/Loss Account with relevant schedules).
- Preparing bank reconciliation and ageing accounts receivable/payable.
- Compiling the general ledger.$$,
 $$- 基于客户记录和提供的做账文件的交易数据处理。
- 以试算表、资产负债表和损益表的形式准备财务管理报表，并附上附表。
- 准备银行对帐、应收账款/应付账款。
- 编制总账。$$,
 'From SGD 1,500.00/year', 1500, null, 'per year (estimated, based on transaction volume)', false, false,
 'Accounting fees are revised according to the volume of work and time required.',
 '会计费用将根据工作量和所需时间进行调整。', false, 17,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Ongoing Maintenance (From Year 2)', 'T2-2', 'Secretarial Services — Yearly', '公司法定秘书服务',
 null, null, 'SGD 700.00/year', 700, 700, 'per year', false, false, null, null, false, 18,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Ongoing Maintenance (From Year 2)', 'T2-3', 'Local Nominee Director Service — Yearly', '本地挂名董事服务（年费）',
 null, null, 'SGD 3,000.00/year', 3000, 3000, 'per year', false, false,
 'No additional deposit from Year 2 onward (already paid in the first year).',
 '第二年起不再另付押金（首年已付）。', false, 19,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Ongoing Maintenance (From Year 2)', 'T2-4', 'Registered Mailing Address — Yearly', '公司注册地址',
 null, null, 'SGD 360.00/year', 360, 360, 'per year', false, false, null, null, false, 20,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Ongoing Maintenance (From Year 2)', 'T2-5', 'Annual Return Services (AGM + Filing)', '年检+股东大会',
 $$- The Company holds its AGM and files its Annual Return with ACRA yearly per the Companies Act 1967 and prevailing ACRA requirements. Annual compliance records (Register of Controllers, KYC) may also be reviewed and updated annually.$$,
 $$- 公司须根据《新加坡公司法1967》及ACRA现行规定，每年召开AGM并提交年度申报；公司合规资料（受益人登记册、KYC）亦可能按年度要求审查及更新。$$,
 'SGD 60.00/year', 60, 60, 'per year', false, false, null, null, false, 21,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Ongoing Maintenance (From Year 2)', 'T2-6', 'Unaudited Report', '非审计报告',
 $$- Compile the company's financial statements, including directors' statement, statement of financial position, statement of comprehensive income, statement of changes in equity and statement of cash flows, with notes to accounts. No audit and/or review procedures are carried out — consequently no assurance is expressed on the financial statements.$$,
 $$- 编制公司财务报表，包括董事报表、财务状况表、综合收益表、权益变动表和现金流量表以及账目说明；不执行审计和/或审查程序，因此不会对财务报表作出任何意见。$$,
 'SGD 700.00/year', 700, 700, 'per year', false, false, null, null, false, 22,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Ongoing Maintenance (From Year 2)', 'T2-7', 'Corporate Taxation', '税务计算与申报',
 $$- Preparing the Company's Income Tax Return and Computation with supporting schedules per the Singapore Income Tax Act.
- Reviewing tax status for claiming Tax Exemption, capital allowances, etc. where applicable.
- Verifying correctness of Notices of Assessment and tax computation from IRAS.
- Updating the Company on recent tax changes.$$,
 $$- 根据《新加坡所得税法》准备公司的所得税申报表和计算表。
- 审查税收状况以申请免税、资本津贴等（如适用）。
- 验证新加坡税务局评估通知和税收计算的正确性。
- 更新公司关于税收政策变化的信息。$$,
 'SGD 700.00/year', 700, 700, 'per year', false, false, null, null, false, 23,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Ongoing Maintenance (From Year 2)', 'T2-8', 'Personal Tax Submission (One Director, incl. Singpass Setup)', '一名董事的个人所得税申报（含个人账户开通）',
 $$- Preparation and submission of individual income tax returns to IRAS, including compilation and review of income information and supporting documents, plus Singpass account opening support. Accuracy/completeness of information supplied remains the taxpayer's own responsibility.$$,
 $$- 协助税务计算及向IRAS提交个人所得税申报，含收入资料整理核对及个人账户（Singpass）开通支持；所提供资料的真实性、准确性及完整性由个人纳税人负责。$$,
 'SGD 300.00/year', 300, 300, 'per year (one director)', false, false,
 'A standalone Feb 2026 price sheet had quoted SGD 400 per individual for Personal Income Tax Filing (no Singpass setup mentioned) — treat this 11 Sep figure as current per Vincent''s instruction.',
 '2026年2月的独立价格表曾报价个人所得税申报$400/人（未提及Singpass开户）——按Vincent指示，以此9月11日数字为准。',
 false, 24, 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Ongoing Maintenance (From Year 2)', 'T2-9', 'Payroll Service', '工资服务',
 $$- Assisting with monthly payroll processing: salary computation, preparation and issuance of payslips, CPF and Skills Development Levy (SDL) submission, and administrative support for payroll records and statutory compliance. For up to 2 persons — SGD 30 per additional headcount per month.$$,
 $$- 协助公司处理每月薪资事务，包括薪资计算、薪水单出具、公积金（CPF）及技能发展税（SDL）申报，以及薪资记录及法定合规相关行政支持；适用于最多2名员工，每增加1名员工加收$30/人/月。$$,
 'From SGD 600.00/year', 600, 600, 'per year (up to 2 staff), plus SGD 30/additional headcount/month', false, false, null, null, false, 25,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Ongoing Maintenance (From Year 2)', 'T2-10', 'XBRL Reporting Service', '转换和准备XBRL报告',
 $$- Full XBRL is required for a company with corporate shareholders. Partial XBRL is required for a company with a net liability position. Other companies are not required to submit XBRL. XBRL (eXtensible Business Reporting Language) is a standard language for electronic communication of business and financial data.$$,
 $$- 如果是具有公司股东或者净负债的公司，XBRL是强制性的：有企业股东的公司需要做完整XBRL格式，净负债公司需要做部分XBRL格式的报告；其他公司不强制提交XBRL报告。$$,
 'On Quote', null, null, null, true, false, null, null, false, 26,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Ongoing Maintenance (From Year 2)', 'T2-11', 'Auditing Services', '公司审计',
 $$- Auditing standards Singapore will be complied with — the auditor will express an opinion in the audit report. A company under a "small group" can be exempt from audit — Tassure's accountant will confirm with the client once year end accounts are done. To qualify as a "small group", the group must fulfil 2 of 3 conditions in the immediately preceding financial year: (1) consolidated revenue not exceeding S$10 million, (2) consolidated total assets not exceeding S$10 million, (3) total group employees not exceeding 50.$$,
 $$- 将遵循新加坡审计标准，审计师将在审计报告中表达意见。小集团公司可以免除审计，每年年底会计师将与客户联系确认。"小集团"须满足以下3个条件中的2个：1）总收入不超过1000万新币；2）总资产不超过1000万新币；3）总人数不超过50名员工。$$,
 'On Quote (once yearly accounts are done)', null, null, null, true, false, null, null, false, 27,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Ongoing Maintenance (From Year 2)', 'T2-12', 'AIS/IR8A Services', '员工年收入申报',
 $$- AIS (Auto-Inclusion Scheme) is IRAS's electronic employment income submission scheme. Employers with 5+ employees must participate in AIS — for employers not participating, IR8A forms are prepared and issued to employees for individual income tax filing.$$,
 $$- AIS（自动纳入计划）是新加坡税务局的电子雇佣收入申报制度；拥有5名或以上员工的雇主必须参加。如未参与AIS，则须准备并向员工发出IR8A表格。$$,
 'F.O.C. (included in package)', null, null, 'per year', false, true, null, null, false, 28,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Ongoing Maintenance (From Year 2)', null, 'Ongoing Maintenance Total (From Year 2)', '公司后期维护所需要的服务费用参考 总计',
 null, null, 'From SGD 7,920.00/year', 7920, null, 'per year (estimated)', false, false,
 'Excludes the on-quote XBRL and Auditing lines above.',
 '不含上方按实报价的XBRL和审计服务两项。', true, 29,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

-- ===================== Table 3: Other Fees / Government Fees =====================
('Other / Government Fees', 'T3-1', 'EP Renewal Service', 'EP续约',
 $$- Administrative assistance for EP renewal: review supporting documents, eligibility assessment and advisory, submission of renewal application to MOM, liaison with relevant authorities, submission of additional documents where required, and administrative support until approval and receipt of the renewed pass card.$$,
 $$- 协助办理EP续签，包括审核相关文件、资格评估及咨询、向MOM提交续签申请、与相关政府机构沟通、在需要时提交补充文件，并提供行政支持直至续签获批。$$,
 'SGD 1,800.00/person', 1800, 1800, 'per applicant, every 2 years', false, false,
 'A standalone Feb 2026 price sheet had quoted SGD 1,500 per applicant (renewal cycle not stated) — treat this 11 Sep figure as current per Vincent''s instruction.',
 '2026年2月的独立价格表曾报价$1,500/人（未注明续签周期）——按Vincent指示，以此9月11日数字为准。',
 false, 30, 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Other / Government Fees', 'T3-2', 'DP Application', '家属准证申请',
 null, null, 'SGD 600.00/person', 600, 600, 'per applicant', false, false, null, null, false, 31,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Other / Government Fees', 'T3-3', 'DP Renewal Service', 'DP续约',
 null, null, 'SGD 600.00/person', 600, 600, 'per applicant, every 2 years', false, false,
 'Government fee included. A standalone Feb 2026 price sheet had quoted SGD 500 per applicant for DP renewal — treat this 11 Sep figure as current per Vincent''s instruction.',
 '含政府费用。2026年2月的独立价格表曾报价DP续签$500/人——按Vincent指示，以此9月11日数字为准。',
 false, 32, 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Other / Government Fees', 'T3-4', 'Letter of Consent (LOC) Application', '工作许可同意书（LOC）申请',
 null, null, 'SGD 200.00/person', 200, 200, 'per applicant', false, false, null, null, false, 33,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

('Other / Government Fees', 'T3-5', 'EP Monthly SDL', '技能发展税（SDL）',
 null, null, 'SGD 135.00/year', 135, 135, 'per year (SGD 11.25/month — payable half-yearly)', false, false, null, null, false, 34,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

-- ===================== Work Pass Renewal (narrative-only in the proposal, no separate price row) =====================
('Service Catalog (Narrative Only)', null, 'Work Pass Renewal Service', '工作准证续签服务',
 $$- Administrative assistance for the renewal of work passes issued by MOM, including EP, S Pass, and DP, or any other passes where applicable — review supporting documents, eligibility assessment and advisory, submission of renewal application to MOM, liaison with relevant authorities, submission of additional documents where required, and administrative support until approval and receipt of the renewed pass card.$$,
 $$- 协助办理由MOM签发的各类准证续签服务，包括EP、S Pass及DP，或其他（如适用）：审核相关文件、资格评估及咨询、向MOM提交续签申请、与相关政府机构沟通、在需要时提交补充文件，并提供行政支持直至续签获批。$$,
 'See EP Renewal / DP Renewal rows for the priced services', null, null, null, true, false, null, null, false, 35,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

-- ===================== Post-Incorporation Changes — Group 1: Company Changes & ACRA Lodgements =====================
('Post-Incorporation Changes — Company Changes & ACRA Lodgements', 'PC1-a', 'Update of Company/Shareholders/Officer Particulars', '公司/股东/管理人员资料更新',
 null, null, 'F.O.C.', null, null, 'per transaction', false, true, null, null, false, 36,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Company Changes & ACRA Lodgements', 'PC1-b', 'Change of Office Registered Address', '更改公司注册地址',
 null, null, 'F.O.C.', null, null, 'per transaction', false, true, null, null, false, 37,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Company Changes & ACRA Lodgements', 'PC1-c', 'Change of Secretary', '更换法定秘书',
 null, null, 'F.O.C.', null, null, 'per transaction', false, true, null, null, false, 38,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Company Changes & ACRA Lodgements', 'PC1-d', 'Change of Business Activities', '变更营业范围',
 null, null, 'F.O.C.', null, null, 'per transaction', false, true, null, null, false, 39,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Company Changes & ACRA Lodgements', 'PC1-e', 'Change of Auditor', '审计师变更',
 null, null, 'F.O.C. if Tassure''s own auditor — SGD 50.00 if an external auditor', 0, 50, 'per transaction', false, false,
 'FOC if the client uses Tassure''s appointed auditor — SGD 50 applies if the client appoints an outside auditor.',
 '如果聘用Tassure指定的审计师则免费；如聘用外部审计师，此变更收费$50。', false, 40,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Company Changes & ACRA Lodgements', 'PC1-f', 'AGM and Annual Return', '股东大会及年检申报',
 null, null, 'F.O.C. (government fee SGD 60 separate)', 0, 0, 'per transaction', false, true,
 'No additional service fee for existing clients — the SGD 60 ACRA government fee is separate.',
 '现有客户无额外服务费用；不包含政府费用$60。', false, 41,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Company Changes & ACRA Lodgements', 'PC1-g', 'Appointment and Resignation of Officer', '管理人员的任命及辞职',
 null, null, 'SGD 100.00', 100, 100, 'per transaction', false, false, null, null, false, 42,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Company Changes & ACRA Lodgements', 'PC1-h', 'Dividend Declaration', '分红',
 null, null, 'SGD 100.00', 100, 100, 'per transaction', false, false, null, null, false, 43,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Company Changes & ACRA Lodgements', 'PC1-i', 'Any Other Lodgement (Other Than Regular Changes)', '除定期更改外的其他任何提文',
 null, null, 'SGD 50.00', 50, 50, 'per transaction', false, false, null, null, false, 44,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

-- ===================== Post-Incorporation Changes — Group 2: Special Resolution & ACRA Lodgements =====================
('Post-Incorporation Changes — Special Resolutions', 'PC2-a', 'Change of Company Name', '公司名称变更',
 null, null, 'SGD 300.00', 300, 300, 'per transaction', false, false, null, null, false, 45,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Special Resolutions', 'PC2-b', 'Amendment of Company Constitution', '修改公司章程',
 null, null, 'SGD 300.00', 300, 300, 'per transaction', false, false,
 'Based on complexity level — a lawyer will be involved for more complex amendments.',
 '根据复杂程度，需要请律师。', false, 46,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Special Resolutions', 'PC2-c', 'Split / Replace Share Certificate', '补股份证书',
 null, null, 'SGD 100.00', 100, 100, 'per transaction', false, false, null, null, false, 47,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Special Resolutions', 'PC2-d', 'Removal of Charge for ACRA Register', '向ACRA消贷款登记',
 null, null, 'SGD 200.00', 200, 200, 'per transaction', false, false, null, null, false, 48,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Special Resolutions', 'PC2-e', 'EGM for Bank Facilities / Other Investment', '银行融资/其他投资的特别股东大会',
 null, null, 'SGD 300.00', 300, 300, 'per transaction', false, false, null, null, false, 49,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Special Resolutions', 'PC2-f', 'Any Other Lodgement (Other Than Regular Changes)', '除定期更改外的其他任何提文',
 null, null, 'From SGD 200.00', 200, null, 'per transaction', false, false, null, null, false, 50,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

-- ===================== Post-Incorporation Changes — Group 3: Share Issue & Transfer =====================
('Post-Incorporation Changes — Share Issue & Transfer', 'PC3-a', 'Allotment of Shares / Increase Paid-Up Capital', '配股/增加实收资本',
 null, null, 'SGD 200.00', 200, 200, 'per transaction', false, false, null, null, false, 51,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Share Issue & Transfer', 'PC3-b', 'Share Transfer', '股份转让',
 null, null, 'SGD 300.00', 300, 300, 'per transaction', false, false,
 'Excludes stamp duty and government fee.', '不包括印花税和政府费用。', false, 52,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Share Issue & Transfer', 'PC3-c', 'Share Transfer With Corporate Shareholder', '与任何公司股东的股份转让',
 null, null, 'SGD 400.00', 400, 400, 'per transaction', false, false,
 'Excludes stamp duty and government fee.', '不包括印花税和政府费用。', false, 53,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

-- ===================== Post-Incorporation Changes — Group 4: Share Capital Deduction =====================
('Post-Incorporation Changes — Share Capital Deduction', 'PC4-a', 'Share Capital Deduction (EGM + ACRA Lodgements)', '降低资本金（出股东大会文件及ACRA登记更新）',
 null, null, 'SGD 2,000.00', 2000, 2000, 'per transaction', false, false, null, null, false, 54,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

-- ===================== Post-Incorporation Changes — Group 5: Trade Mark =====================
('Post-Incorporation Changes — Trade Mark', 'PC5-a', 'Trade Mark Application (Singapore)', '商标申请（新加坡）',
 $$- Apply for a trade mark and assist with preparing the documents.$$,
 $$- 申请商标并协助准备文件。$$,
 'SGD 900.00', 900, 900, 'one-time', false, false,
 'Extra SGD 400 per additional class.', '每多一个类别，另加$400。', false, 55,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

-- ===================== Post-Incorporation Changes — Group 6: Secretary Attendance Services =====================
('Post-Incorporation Changes — Secretary Attendance', 'PC6-a', 'Bank Attendance (for Bank Requirement)', '协助并出席银行会议要求',
 null, null, 'SGD 200.00', 200, 200, 'one-time', false, false, null, null, false, 56,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Secretary Attendance', 'PC6-b', 'Court Attendance (for Tax Purpose)', '代表税务目的协助并出庭',
 null, null, 'SGD 500.00', 500, 500, 'one-time', false, false, null, null, false, 57,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

-- ===================== Post-Incorporation Changes — Group 7: Voluntarily Striking Off =====================
('Post-Incorporation Changes — Striking Off', 'PC7-a', 'Voluntary Striking Off — Dormant Company', '自愿注销公司（休眠公司）',
 null, null, 'SGD 500.00', 500, 500, 'one-time', false, false, null, null, false, 58,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Striking Off', 'PC7-b', 'Voluntary Striking Off — Active Company', '自愿注销公司（活跃公司）',
 null, null, 'SGD 600.00', 600, 600, 'one-time', false, false, null, null, false, 59,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

-- ===================== Post-Incorporation Changes — Group 8: Corporate Account Closure =====================
('Post-Incorporation Changes — Account Closure', 'PC8-a', 'Corporate Account Closure Service', '企业账关闭申请服务',
 $$- Assist to close the corporate bank account.$$, $$- 协助关闭公司帐户。$$,
 'SGD 200.00', 200, 200, 'one-time', false, false, null, null, false, 60,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),

-- ===================== Post-Incorporation Changes — Group 9: Other / Additional Services =====================
('Post-Incorporation Changes — Other Services', 'PC9-a', 'CTC Documents', '文件见证签字',
 null, null, 'SGD 50.00', 50, 50, 'per set', false, false, null, null, false, 61,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Other Services', 'PC9-b', 'Register of Director/Shareholder/Secretary etc.', '董事/股东/秘书等的登记册',
 null, null, 'SGD 40.00', 40, 40, 'per set', false, false, null, null, false, 62,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Other Services', 'PC9-c', 'Lodgement of Register of Controller', '实际控制人登记册的递交',
 null, null, 'SGD 80.00', 80, 80, 'per lodgement', false, false, null, null, false, 63,
 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Post-Incorporation Changes — Other Services', 'PC9-d', 'KYC / Due Diligence / CDD / Background / Compliance Checking', 'KYC/尽职调查/CDD/背景/合规性检查',
 null, null, 'SGD 100.00', 100, 100, 'per time', false, false, null, null, false, 64,
 'Tassure_Proposal__20260911001.docx', '2026-09-11')

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

INSERT INTO public.company_service_terms (topic, content_en, content_cn, display_order, source_document, source_updated_on)
VALUES
('Payment Terms',
 'The Company shall pay the applicable service fees in accordance with the quotation, invoice, or service package agreed between the parties. Unless otherwise agreed in writing, all service fees shall be payable in advance before commencement of the relevant service. Government fees, filing fees, application fees, statutory charges, courier fees, translation fees, notarisation fees, and any third-party disbursements are not included in the service fees unless expressly stated, and shall be borne by the Company separately. The Company shall provide all required information and supporting documents in a timely, accurate, and complete manner — any delay caused by the Company, a government authority, or a third party is not deemed a delay or default by Tassure as the service provider.',
 '客户须根据双方确认的报价、账单或服务配套支付相应服务费用。除非双方另有书面约定，所有服务费用须在相关服务开始前预先支付。除非另有明确说明，政府费用、申报费用、申请费用、法定收费、快递费、翻译费、公证费及任何第三方代垫费用均不包含在服务费内，并应由客户另行承担。客户须及时、准确、完整地提供所需资料及文件；因客户、政府机构或第三方原因导致的延误，不视为服务提供方延误或违约。',
 1, 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Service Termination & Refund',
 'Services remain in force until terminated by either party giving two months'' notice. Payment for any unexpired period of services is refundable to the company.',
 '服务将一直有效，直到任何一方在发出两个月的通知后终止为止。未到期的服务付款将退还给公司。',
 2, 'Tassure_Proposal__20260911001.docx', '2026-09-11'),
('Confidentiality & Indemnity',
 'Services are performed on a confidential basis — no information will be released to third parties except employees in charge of the account or another person designated in writing by the client. The company and its directors agree to indemnify Tassure for losses, damages, costs and expenses relating to proper performance of duties, unless caused by Tassure''s wilful default or negligence. Tassure indemnifies the company against actions, proceedings, claims or demands brought by government agencies as a consequence of any neglect or default by Tassure in performing the services.',
 '服务在保密基础上进行，除负责账户的员工或客户书面指定的其他人外，不会将任何信息透露给第三方。公司及其董事同意就因履行职责所引起的损失、损害、成本和费用向Tassure作出赔偿，除非是由于Tassure故意违约或疏忽造成的。对于因Tassure在履行服务过程中的疏忽或违约而导致政府机构对公司提出的诉讼、索赔或要求，Tassure将给予相关费用和支出的赔偿。',
 3, 'Tassure_Proposal__20260911001.docx', '2026-09-11')
ON CONFLICT (topic) DO UPDATE SET
  content_en = EXCLUDED.content_en,
  content_cn = EXCLUDED.content_cn,
  display_order = EXCLUDED.display_order,
  source_document = EXCLUDED.source_document,
  source_updated_on = EXCLUDED.source_updated_on,
  updated_at = now();
