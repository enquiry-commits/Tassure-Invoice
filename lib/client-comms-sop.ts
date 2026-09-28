// Tassure's own secretarial client-communication SOP, as topic-keyed
// knowledge for the My Tasks assistant's get_sop_guide tool
// (app/api/assistant/route.ts). Source: "Communication anf Useful form
// details.docx" — the secretarial team's internal notes, shared with Vincent
// by a colleague on 2026-09-28 ("这是我们跟客户沟通一些沟通note，你准备AI
// 助手可能需要用到").
//
// Why a lookup tool rather than the system prompt: the full source is about
// the size of the assistant's whole cached static prompt, and most turns
// never need it. The model fetches ONE topic when a question is actually
// about one (Vincent chose this, 2026-09-28).
//
// Deliberately NOT here yet (Vincent: "先上流程和文件解释，日期/金额等确认后
// 补"): every part of the source that states a specific calendar date, a
// fee, a penalty, a tax rate, a monetary threshold or a statutory deadline.
// PENDING_REVIEW names those parts by title only — never with the figure —
// so the assistant says that part is still awaiting confirmation instead of
// guessing, or quoting a possibly stale number as Tassure's position.
// test-sop-guide.ts fails if any of those figures leaks into this file. When
// the team confirms one, move it in here and drop it from PENDING_REVIEW in
// the same change.
//
// Text is the source's own wording, split at item/script level. The only
// edits: unambiguous typo fixes (新加披→新加坡, 负债贵司→负责贵司,
// "1-3三个工作日"→"1-3个工作日", pre-empty→pre-emption, hanover→handover,
// INDENNITY/UNDERTANKING, "If you company"); one staff instruction moved out
// of a client script into an internal note ("(tag the PIC)"); and one unclear
// word dropped from a payment script ("还麻烦您这集团安排…" → "还麻烦您安排…",
// the intended word is unknown). Unanswered FAQ lists and the "Sharing"
// section (named client cases) are left out entirely.
//
// Deliberately NOT `server-only`: pure static data, no secrets or I/O, so the
// deterministic test can import it directly (same as lib/late-filing-
// categorize.ts). Only app/api/assistant/route.ts and lib/ai/orchestrator.ts
// import it.

export const SOP_TOPICS = [
  'incorporation',
  'transfer_in',
  'annual_return',
  'share_transfer',
  'share_allotment',
  'payment_chasing',
  'nd_agreement',
  'section_156',
  'letter_of_indemnity',
  'engagement_letter',
  'new_company_documents',
] as const;

export type SopTopic = typeof SOP_TOPICS[number];

// 'client' = the team's own client-facing wording (a script, or a
// plain-language explanation) that staff may adapt and send themselves.
// 'staff' = internal checklist or note — never pasted into a client message.
export type SopBlock = {
  audience: 'client' | 'staff';
  heading: string;
  lines: string[];
};

type SopSection = {
  title: string;
  covers: string;
  blocks: SopBlock[];
};

export const SOP_SOURCE = {
  document: 'Communication anf Useful form details.docx',
  owner: 'Tassure secretarial team — internal client-communication notes',
  receivedOn: '2026-09-28',
  lastUpdated: '2026-09-28',
} as const;

const NOMINEE_SHAREHOLDER_NOTE = '如果公司是挂名股东，要拿 trust agreement，然后确认他们 nominator 是谁，准备 RONS。';
const CINDY_MEETING_NOTE = '要确定是否 Cindy 有见过客户，如果没有要安排视频会议。';

export const SOP_SECTIONS: Record<SopTopic, SopSection> = {
  incorporation: {
    title: '新公司注册 Incorporation',
    covers: '注册新加坡公司：前期沟通、需要客户提供的资料、成立前签字文件、身份核实、跟客户沟通的要点、注册流程与所需时间',
    blocks: [
      {
        audience: 'staff',
        heading: '前期沟通',
        lines: ['前期沟通，发注册公司表格 & KYC 表格。尽可能电话联系客户，解释表格和注册程序。'],
      },
      {
        audience: 'client',
        heading: '所需资料（可以跟客户这样说）',
        lines: [
          '您好，关于在新加坡成立公司事宜，以下是所需提供和填写的资料文件：',
          '1. 请填写附件中的两份注册表格',
          '2. 所有公司董事、股东的NRIC或护照，还有各一张日期是最近三个月的住址证明单子（例如 电话单、水电单或银行单或者其他物业管理信件等都可以，有显示完整名字，完整地址和日期是最近三个月内）',
          '3. 如有企业股东，需要提供该企业股东公司的注册证书/注册纸，章程，公司授权代表证书，公司股权结构图和财务报表，以及企业代表的护照/一张近三个月内的住址证明/邮箱/联系号码',
        ],
      },
      {
        audience: 'client',
        heading: '成立前签字文件',
        lines: [
          '我们收到以上填写的注册表格和董事股东信息后，会准备相关成立前的注册文件给您一起安排签字：',
          '- Form 45 同意出任董事表格',
          '- CDD Form 客户尽职调查表格',
          '- Form of Notice Mentioned in Section 386 实际控制人确认函',
          '- PDPA Form 个人资料保护法令表格',
        ],
      },
      {
        audience: 'staff',
        heading: '身份核实（内部）',
        lines: [CINDY_MEETING_NOTE],
      },
      {
        audience: 'client',
        heading: '无法安排实体会议时的身份核实方式',
        lines: [
          '对于我们无法安排实体会议的董事/股东/实际受益人，替代方法如下：',
          'i) 由律师或公共会计师认证的身份证件/居住地址证明',
          'ii) 合规团队将安排视频会议以核实其身份（准备身份证/护照、白纸和笔，我们会核实身份和了解公司业务和验证签名）',
        ],
      },
      {
        audience: 'staff',
        heading: '跟客户沟通内容',
        lines: [
          '1）公司名字，尽量避免敏感字眼 SINGAPORE, ASIA, 或是 EDUCATION 等，跟其他部门有关联，会被审核。一般新加坡私人有限公司的后缀是 Pte. Ltd.（参考 https://www.acra.gov.sg/how-to-guides/before-you-start/referral-authorities ）',
          '2）公司是否有本地董事，是否提供挂名董事，如挂名董事，建议2位外国董事。',
          '3）公司业务是做什么，协助找相关的业务编号给客户。比如业务是相关教育，诊所，学校等会被ACRA审核。（同上 referral-authorities 链接）',
          '4）注册资金：要提醒客户，新加坡是实缴制度的，所以一旦决定了注册资金是多少，股东必须要实缴所有的注册资金到公司的银行账户，资金只能作为公司运作使用。用词：Share capital – 股本/注册资金；Number of shares – 股份数；Paid-up capital – 实缴资金。（建议金额、实缴期限和资金记录示例见 pendingReview）',
          '5）注册地址，公司是否有自己的办公室。如没有可以使用我们的注册地址服务。',
          '6）财政年：如有企业股东，为了便于集团做报告，子公司的财政年度可能需要与其控股公司的财务年度一致。（第一个财政年怎么定的建议见 pendingReview）',
          '7）RORC，持有25%以上股份的股东将默认为公司的实际控制人或最终受益人，可以控制公司决策。',
        ],
      },
      {
        audience: 'client',
        heading: '收到完整的文件表格后（可以跟客户这样说）',
        lines: [
          '我们收到完整的信息签字表格会提交内部审核公司文件，需要1-3天。审核批准和收到付款后，便会提交给政府注册公司。如果没有被政府抽查审核的情况下，1-3个工作日就能注册下来。',
          '如果被政府审核，审核需要14天-2个月的时间。但以我们的经验，一般都是政府循例审核，没有问题的话，大概7个工作日内就有结果了。',
        ],
      },
      {
        audience: 'client',
        heading: '注册流程及所需时间（预估）——流程图《新加坡公司成立流程及资料详解》',
        lines: [
          '① 公司基本信息收集（1-3个工作日）：客户填写公司注册意向书——公司基本信息、股东个人信息、股东出资金额等内容并提交给我们',
          '② 客户背景调查（1-3个工作日）：所有公司董事和股东的护照、身份证复印件、一张日期最近三个月的住址证明（电话单/水电单/银行单皆可）；股东涉及到企业的，还需要公司的证书/注册纸、公司架构图、最终受益人声明、公司章程、财务报表、指定一个公司代表',
          '③ 资料核查及客户签字（1-2个工作日）：董事和股东签字——公司注册意向书、KYC表格及CDD FORM（客户背景调查表格）、FORM 45',
          '→ 客户付款',
          '④ 向ACRA提交资料（1个工作日）',
          '⑤ 公司成立：通常1-3个工作日。若资料有问题，需要被政府核查，周期为2周-2个月。但此种情况为政府要求的特殊情况，很少出现。如若出现我们会协助客户进行核查。',
          '表格模板由 Tassure Group 实信集团为您提供，您只需要对应填写内容及文字即可；我们会持续与您沟通项目进展，也会协助您处理任何特殊情况。',
        ],
      },
    ],
  },

  transfer_in: {
    title: '转秘书 Transfer In（接手现有公司的秘书服务）',
    covers: '客户把现有公司转给我们做秘书：前期沟通、要跟客户确认的内容、takeover 流程和时间、发资料的话术',
    blocks: [
      {
        audience: 'staff',
        heading: '前期沟通（内部）',
        lines: ['前期沟通，尽可能电话联系客户了解公司情况。', CINDY_MEETING_NOTE],
      },
      {
        audience: 'staff',
        heading: '跟客户确定的内容',
        lines: [
          '公司的业务是做什么，在新加坡有没有办公室和员工，秘书公司',
          '目前公司有没有运作，银行账户',
          '了解公司FYE，advise AGM AR deadline（如果客户不清楚就说我们会到时候协助查看后续会advise）',
          '后期需不需要我们安排做账和报税',
          '有没有需要挂名董事和地址服务',
          '大概跟说明 takeover 需要的资料，takeover 的流程',
        ],
      },
      {
        audience: 'client',
        heading: 'Takeover 流程（可以跟客户这样说明）',
        lines: ['提供资料给我们后，我们会完成尽职调查（2个工作日），没问题我们会开发票给贵司安排付款，准备转秘书文件和联系现在的秘书交接，变更文件准备好了会发给你们安排签字，收到所有签字文件和付款我们会进行变更，整个流程大概7-10工作日完成。'],
      },
      {
        audience: 'staff',
        heading: '联系之后',
        lines: ['联系完之后，email 或者 wechat 客户需要的转秘书资料，then follow up。'],
      },
      {
        audience: 'client',
        heading: '发转秘书资料时（可以跟客户这样说）',
        lines: ['您好，谢谢您确定公司交由我们公司秘书维护，请协助提供附件的资料和KYC 表格给我们完成尽职调查。如有疑问，我们可以安排电话进一步沟通，谢谢。'],
      },
      {
        audience: 'staff',
        heading: '英文版',
        lines: ['原文件注明 "For English, please refer SOP" —— 英文版在另一份 SOP，没有收录在这里。'],
      },
    ],
  },

  annual_return: {
    title: '年检 Annual Return / AGM',
    covers: '年检第一次提醒、客户交来资料后的回复、dormant（休眠）公司要确认的事项、做账需要客户提供的资料清单',
    blocks: [
      {
        audience: 'client',
        heading: 'First reminder 第一次提醒（中文）',
        lines: ['您好，我们有电邮了公司年检通知给贵司，XXX PTE. LTD. 需要准备提交年检了，如果需要我们协助安排做账，请提供账目/做账资料发给我们报价和准备财务报告，请查收邮箱和尽快跟我们确定。谢谢。'],
      },
      {
        audience: 'client',
        heading: 'First reminder (English)',
        lines: ['We have emailed your company a notice for the annual return. XXX PTE. LTD. needs to prepare and submit the annual return. If you require assistance in arranging accounting services, please provide us with your accounting records/documents so that we can provide a quotation and prepare financial reports. Please check your email and confirm with us as soon as possible. Thank you.'],
      },
      {
        audience: 'client',
        heading: '客户提供文件后（可以跟客户这样说）',
        lines: ['谢谢您提供的文件，我们已经发给了会计部门进行报价，这边跟您介绍负责贵司的账目的同事是XXX，稍后他会发给您报价确认，谢谢。'],
      },
      {
        audience: 'staff',
        heading: '客户提供文件后（内部）',
        lines: [
          '上面的 XXX 处 tag 负责账目的 PIC。',
          'Please contact account PIC to contact client, ensure handover to account department smoothly, follow up with account PIC status.',
        ],
      },
      {
        audience: 'staff',
        heading: 'If dormant — 跟客户确认',
        lines: [
          '1. 有没有银行账户，如果有要做账，如果没有可以直接准备 dormant AGM',
          '2. 如果客户有银行可是不想做账，提供我们 bank statement proof 只有 bank charge during the year, then we can still prepare dormant AGM',
          '4. 如果公司 UBO 是上市公司，they need prepare unaudited FS and XBRL but it could be unaudited, if active then need go audited',
          '（第3点——企业股东 + dormant 的情形——见 pendingReview）',
        ],
      },
      {
        audience: 'client',
        heading: '需要什么做账资料 — If your company is active (English)',
        lines: [
          'If you have engaged or are considering engaging us for accounting, financial report or auditing services, kindly provide us the following documents for the financial period stated above:',
          '- Bank statements',
          '- Sales invoices and records',
          '- Salary schedules / CPF records',
          '- Purchases or Cost of sales invoices / receipts',
          '- Expenses records and invoices / receipts',
          '- Any other accounts related document (e.g., Rental contract or other business contract and others if any)',
        ],
      },
      {
        audience: 'client',
        heading: '需要什么做账资料 — 如果您的公司正在运营（中文）',
        lines: [
          '如果您已经确定或需要使用我们的会计，财务报告，税务或者审计服务，请尽快向我们提供以下文件：',
          '- 银行月结单',
          '- 销售发票及记录',
          '- 薪资和公积金记录',
          '- 成本支出发票或收据',
          '- 花费发票或收据',
          '- 其他相关文件，例如，租赁合同及其他商业合同等',
        ],
      },
      {
        audience: 'client',
        heading: '账目已做好，只需要财务报告和报税 (English)',
        lines: [
          'If your accounts are ready, and you have engaged or are considering our financial report and tax service only, please provide us the following documents for the financial period stated above for our accountant to prepare an unaudited financial report and tax compliance for you:',
          '- Statement of Income',
          '- Statement of Financial Position',
          '- Accounts Schedules (e.g. Fixed assets, Director accounts, Accruals etc.)',
          '- General Ledger and Trial Balance',
          '- Any other accounts related document (e.g. Rental contract or other business contract and others if any)',
        ],
      },
      {
        audience: 'client',
        heading: '账目已做好（中文）',
        lines: [
          '如果您已经做好了流水帐目，并已经确定或者需要我们安排做财务报告或者审计，税务服务，请提供以下文件以便我们进行财务报告（审计或者非审计报告）和税务的准备：',
          '- 损益表',
          '- 资产负债表',
          '- 帐户明细表（例如固定资产，董事帐户，应计费用等）',
          '- 总帐和试算表余额',
          '- 其他相关文件，例如，租赁合同及其他商业合同等',
        ],
      },
    ],
  },

  share_transfer: {
    title: '股份转让 Share Transfer（转股）',
    covers: '转股需要客户提供的资料、要跟客户了解的情况、挂名股东的额外文件',
    blocks: [
      {
        audience: 'staff',
        heading: '了解公司需要转让股份，请让我们知道',
        lines: [
          '1. 新股东信息（提供护照/身份证/住址证明文件，email & 联系电话），如果是公司股东提供公司的信息，架构图，公司代表，受益人信息',
          '2. 转股的数额（有时客户是给比例，要帮忙算）',
          '3. 交易对价（解释股份卖出的价格）',
          '4. 股份买卖合同（如有）- 建议律师起草',
          '5. 如果需要，准备 pre-emption right（留意 shareholder agreement, M&A）',
        ],
      },
      {
        audience: 'staff',
        heading: '跟客户沟通了解',
        lines: [
          '公司为什么转股',
          '实际控制人有没有变动，如果有要准备 Notice 386',
          '如果公司变化很大，需要重新做尽职调查',
          '公司有没有 property，如果有 property stamp duty 就不一样（可以 refer FS 或者跟客户确认）- property valuation report',
        ],
      },
      {
        audience: 'staff',
        heading: '挂名股东',
        lines: [NOMINEE_SHAREHOLDER_NOTE],
      },
    ],
  },

  share_allotment: {
    title: '增资扩股 Share Allotment',
    covers: '增资扩股要跟客户确认的事项、递交前必须拿到的证明、挂名股东的额外文件',
    blocks: [
      {
        audience: 'staff',
        heading: '要跟客户确认',
        lines: [
          '增资的数额和股份数，不一定是一股一块',
          '如果影响到旧股东的比例，受益人的比例，需要准备提醒和通知客户',
          '如果需要，准备 pre-emption right（留意 shareholder agreement, M&A）',
          'pass Section 161（sec 161）',
        ],
      },
      {
        audience: 'staff',
        heading: '确保要拿到 before lodgement',
        lines: ['bank proof（deposit screenshot and bank balance）'],
      },
      {
        audience: 'staff',
        heading: '挂名股东',
        lines: [NOMINEE_SHAREHOLDER_NOTE],
      },
      {
        audience: 'staff',
        heading: '客户常问——原文件只列了这些问题，没有给出标准答案（不要当作 SOP 的结论来回答）',
        lines: [
          '增资后钱还可以再拿出来吗？',
          '必须要实缴吗？',
          '如果目前资金不够可不可以用红利增资？',
          '可以用 retain earning（留存收益）增资吗？',
          '公司有欠股东钱（AMOUNT DUE TO SHAREHOLDER），可以用来增资吗？',
        ],
      },
    ],
  },

  payment_chasing: {
    title: '催款 Payment chasing（服务费未付）',
    covers: '客户服务费用未付时，跟客户说的话术（XXX = 发票总额）',
    blocks: [
      {
        audience: 'client',
        heading: '通知未付（附上未支付的发票）',
        lines: ['您好，财务这边通知说贵司还有服务费用还没支付，这边附上未支付的发票给您，总额是XXX，还麻烦您安排一下付款哦，付款了请提供付款截图给我们方便财务记录，谢谢。'],
      },
      {
        audience: 'client',
        heading: '跟进（仍未收到付款）',
        lines: ['您好，财务还是没收到付款哦，还请尽快安排一下付款，谢谢。'],
      },
      {
        audience: 'client',
        heading: '提醒客户查收财务部门的付款通知',
        lines: ['您好，我们的财务部门有发了付款通知给您，请查收邮箱和安排支付一下我们的服务费用哦，总额是XXX，请尽快安排一下哦，谢谢。'],
      },
    ],
  },

  nd_agreement: {
    title: '挂名董事协议 Nominee Director (ND) Agreement',
    covers: '怎么跟客户解释挂名董事协议的内容',
    blocks: [
      {
        audience: 'client',
        heading: '跟客户解释可以说',
        lines: [
          '这份文件是公司对于挂名董事的承诺书，目的是为了确保双方都能够信守承诺，并在需要时提供法律保护。这是一份委任协议的条款，规定了挂名董事在担任公司董事期间的责任和服务费用等事项。',
          '保护挂名董事免受可能因其行事而引起的法律诉讼或索赔，但排除故意或疏忽违反法律或指令所导致的情况。',
          '保证及时支付挂名董事提供服务的费用，包括报销和支出。',
          '不提供违法指令，董事也不会执行非法指令。',
          '如有必要，在指定董事提出书面请求后30天内指定替代董事，否则由挂名董事和公司自行指定替代董事。',
          '确保公司依法召开年度股东大会，准备必要的财务报表并及时提交给新加坡的注册管理机构。',
          '确保公司依法申报年度所得税，并及时缴纳给新加坡的税务机构。',
          '遵守新加坡和任何相关司法管辖区的法律。',
          '如果公司的股东、董事或联系人超过6个月无法联系，或公司逾期未支付给挂名董事和公司的费用超过三个月且已收到两次催缴通知，则挂名董事有权关闭公司银行账户，注销公司并向监管机构提交必要文件，清偿所有债务并从股东处追回款项。',
          '协议约定的义务对我们的遗产继承人和权利继承人具有约束力。',
          '如股东三个月内未回应任何通讯，则应签署并交付附表1中的代理表格，指定挂名董事或Tassure指定的代表作为公司股东的代理，在股东大会上行使投票权或签署书面决议。',
        ],
      },
    ],
  },

  section_156: {
    title: 'S156 表格 Section 156（董事利益披露）',
    covers: '怎么跟客户解释 S156 表格（口头版和 email 版）',
    blocks: [
      {
        audience: 'client',
        heading: '跟客户解释可以说',
        lines: ['这份表格是如果董事有在其他公司有任职的话，可以写出来披露。不披露也行，只要确保您在其他公司的职位和目前这间新公司没有任何利益冲突。'],
      },
      {
        audience: 'client',
        heading: 'By email',
        lines: [
          '这涉及到董事的利益表格。确保公司管理层的透明度和诚信度。',
          '这个表格要求董事提供关于他们在公司中可能存在的利益，这包括他们拥有或可能受益于的股份、合同或交易。这种要求的目的是防止董事利用其地位谋取私利，同时也为投资者和利益相关者提供了透明度，让他们更好地了解公司的管理情况。',
          '填写这份表格不仅是为了满足法律要求，更是为了维护公司的声誉和您作为董事的信誉。',
        ],
      },
    ],
  },

  letter_of_indemnity: {
    title: '赔偿及承诺书 Letter of Indemnity and Undertaking（公司对秘书）',
    covers: '怎么跟客户解释公司给秘书的赔偿及承诺书',
    blocks: [
      {
        audience: 'client',
        heading: '跟客户解释可以说',
        lines: [
          '这份文件是公司对于秘书的承诺书，目的是为了确保双方都能够信守承诺，并在需要时提供法律保护。',
          '公司对秘书的一系列承诺为：',
          '- 赔偿保障：公司保证将对秘书在履职过程中产生的各种费用、损失、诉讼等进行赔偿，但排除了因秘书自身疏忽、违约或违反职责而引起的责任。',
          '- 提供法律辩护费用：公司还将对秘书在应诉过程中产生的费用进行赔偿，前提是判决有利于秘书或秘书被无罪释放。',
          '- 费用和支出支付：公司同意支付秘书的费用，并报销其履职过程中发生的费用。',
          '- 辞职权：秘书有权随时辞职，公司将立即任命新的秘书。',
          '- 财务支持：如果公司处于休眠状态，承诺支付秘书的费用和其他涉及的服务支出。',
          '- 执行董事任命：公司将指定一位执行董事负责公司管理，包括维护会计记录。',
          '- 提供账目：公司将向秘书提供所需的账目，或者在公司尚未开始交易或已停止业务时通知秘书。',
          '这些承诺受新加坡共和国法律管辖，公司同意就与这些义务和责任相关的事项向新加坡法院提交。',
        ],
      },
    ],
  },

  engagement_letter: {
    title: '秘书服务聘用函 Engagement Letter',
    covers: '怎么跟客户解释秘书服务聘用函（概要和条款要点）',
    blocks: [
      {
        audience: 'client',
        heading: '跟客户解释（概要）',
        lines: ['这份文件是秘书公司对企业提供秘书服务的合作信，包括帮助公司遵守法规、准备文件等工作。费用为每年XXX，并代表公司报销会发生的费用 (government fee)。授权代表公司与政府机构处理事务，并且公司需要保障秘书公司免受可能产生的法律索赔。如果公司的费用逾期未付，秘书公司可以停止服务。协议的有效期为自生效之日起，需要提前一个月通知才能结束合作关系。协议内容是保密的，不得向未经授权的人透露。公司董事也会承诺遵守法规等。'],
      },
      {
        audience: 'client',
        heading: '条款要点',
        lines: [
          '- 秘书服务：包括维护法定记录、提供合规建议、准备年度股东大会文件等常规秘书工作。然而，与特别股东大会或非例行决议有关的任务将另行收费。',
          '- 秘书费用：为提供上述服务收取每年XXX的费用，并报销代表公司发生的费用。',
          '- 登记授权：服务提供商被授权代表公司处理与ACRA的事务，并执行与公司秘书事务相关的电子服务。公司保障服务提供商免受由此引起的任何索赔或责任。',
          '- 责任限制：如果费用逾期超过90天，服务提供商可能会在无需承担责任的情况下停止服务。',
          '- 协议条款：协议自生效之日起生效，并持续至给予一个月通知或支付一个月费用为止。',
          '- 保密性：协议内容视为保密，不得向未经授权的第三方透露。',
          '- 承诺/限制：董事会承诺遵守《1967年公司法》，并承担因违规而产生的索赔责任，但不包括由于疏忽或恶意行为引起的责任。服务提供商的责任受到年度费用的限制。',
          '- 法律约束：协议的解释和执行受新加坡法律管辖。',
        ],
      },
    ],
  },

  new_company_documents: {
    title: '新公司文件包（15份）各自的用途',
    covers: '新公司成立后那套文件，每一份是做什么用的',
    blocks: [
      {
        audience: 'client',
        heading: '文件及用途',
        lines: [
          '1. Minutes on First Board Resolution（首次董事会决议记录）：记录公司首次董事会会议中做出的决议，包括任命董事、任命秘书等关键决策。',
          '2. Consent to Appointment of Director of the Company（公司董事任命同意书）：个人同意被任命为公司董事。',
          '3. PDPA Form（个人数据保护法表格）：确保符合《个人数据保护法》（PDPA），该法管理新加坡个人数据的收集、使用和披露。',
          '4. Form 45（45表格）：新加坡法定声明表格，任命公司董事。',
          '5. Secretary Appointment Letter（秘书任命书）：正式任命个人为公司秘书，负责维护公司记录并确保符合法规要求。',
          '6. Share Certificates（股份证书）：股份证书，发给股东。',
          '7. Engagement Letter and Indemnity, Undertaking of Secretarial Services（秘书服务聘用函及赔偿、承诺书）：该文件概述了聘用秘书服务的条款，并包括赔偿和承诺条款。',
          '8. Authorization Letter on RORC Lodgment（RORC登记授权书）：授权相关人员提交《可登记控制人登记册》（RORC），这是新加坡法律要求的。',
          '9. Form of Notice Mentioned in Section 386（实际控制人/受益人通知表格）：与新加坡《公司法》第386条款下的法定要求有关，通常涉及向成员或董事发出通知，实际控制人/受益人签字确认。',
          '10. Declaration of RORC (Register of Registrable Controller)（可登记控制人声明）：声明公司可登记控制人的信息，必须向会计与企业监管局（ACRA）提交。',
          '11. Declaration of ROND (Register of Nominee Director)（挂名董事登记声明）：根据新加坡法规要求，声明任何挂名董事的详细信息。',
          '12. Declaration of RONS (Register of Nominee Shareholder)（挂名股东登记声明）：根据新加坡法规要求，声明任何挂名股东的详细信息。',
          '13. S156 Declaration of Directorship（S156董事职务声明）：根据《公司法》第156条款，董事须披露其在交易或其他事项中的利益。',
          '14. Constitution（公司章程）：公司章程，概述公司的规则、法规和结构。',
          '15. CDD Form（客户尽职调查表格）：客户尽职调查（CDD）表格用于验证客户身份，通常是反洗钱（AML）程序的一部分。',
        ],
      },
    ],
  },
};

// Parts of the source SOP withheld until the team confirms them — titles
// only, never the figure (see the header comment).
export const PENDING_REVIEW: { topics: SopTopic[]; item: string }[] = [
  { topics: ['incorporation'], item: 'DPO（数据保护官）委任说明及相关收费' },
  { topics: ['incorporation'], item: '董事联系地址/替代地址（ACRA 新规）说明及政府费用' },
  { topics: ['incorporation'], item: '注册资金：建议金额、实缴期限、注册时的资金记录示例' },
  { topics: ['incorporation'], item: '第一个财政年（FYE）怎么定的建议' },
  { topics: ['incorporation', 'annual_return'], item: '新公司首三年税务减免、企业所得税' },
  { topics: ['incorporation', 'annual_return'], item: 'ECI 预估税申报说明及豁免条件' },
  { topics: ['incorporation', 'annual_return'], item: '法定申报截止日期一览（AGM、年检、报税等）' },
  { topics: ['incorporation', 'annual_return'], item: '审计门槛及 XBRL 要求' },
  { topics: ['annual_return'], item: '年检跟进提醒、再次提醒、逾期未交的话术（含罚款金额）' },
  { topics: ['annual_return'], item: '“公司什么时候年检”的标准回答（含期限）' },
  { topics: ['annual_return'], item: 'Dormant 第3点：企业股东 + dormant 时的判定（dormant relevant company 的定义）' },
  { topics: ['nd_agreement'], item: '挂名董事服务费及逾期利息条款' },
];

export const SOP_TOOL_NOTE = `Tassure's OWN internal secretarial SOP (the secretarial team's client-communication notes; see source). audience "client" = the team's own client-facing wording (scripts / plain-language explanations) that staff may adapt and send themselves; audience "staff" = internal checklist or note — never paste those verbatim into a client message. You only DRAFT text: you cannot send WeChat/WhatsApp/email (for a real AR/SOA/document reminder email, preview_email_draft is the real path). XXX placeholders (company name, PIC, amount, date, annual fee) may only be filled from a real tool result this turn (e.g. check_outstanding_balance for an amount owed, company_deep_lookup for a PIC) — otherwise leave XXX for the staff member; never invent them. pendingReview = parts of the source SOP still awaiting internal confirmation and deliberately withheld: say the SOP wording for that part is not confirmed yet, and never state a fee, penalty, tax rate, threshold or deadline as Tassure's own position (Tassure's prices come only from service_pricing_lookup; if you add general public information, e.g. via web_search, label it as such). Nothing here is ever a billing or invoice amount. Scripts are Chinese-first; an English version you write yourself is your translation, not official SOP wording — say so.`;

export function isSopTopic(value: string): value is SopTopic {
  return (SOP_TOPICS as readonly string[]).includes(value);
}

// The exact object get_sop_guide hands the model. Kept here (not in
// route.ts) so test-sop-guide.ts can check the real payload's size against
// the tool loop's 6000-char tool_result cut — anything past it would reach
// the model as truncated, invalid JSON.
export function getSopGuide(topicInput: string) {
  const topic = topicInput.trim().toLowerCase();
  if (!isSopTopic(topic)) {
    return { error: true as const, message: `Unknown SOP topic "${topicInput}". Valid topics: ${SOP_TOPICS.join(', ')}.` };
  }
  const section = SOP_SECTIONS[topic];
  return {
    topic,
    title: section.title,
    covers: section.covers,
    blocks: section.blocks,
    pendingReview: PENDING_REVIEW.filter(p => p.topics.includes(topic)).map(p => p.item),
    source: SOP_SOURCE,
    note: SOP_TOOL_NOTE,
  };
}

// Words that mark a question as being about Tassure's own secretarial SOP
// even when it names no company or client ("股份转让要准备什么", "S156 怎么
// 解释"). lib/ai/orchestrator.ts treats these like its own INTERNAL_TERMS so
// such a question stays on Claude, where get_sop_guide exists, instead of
// being routed to the OpenAI-only general answer (INV-AI-003).
export const SOP_ROUTING_TERMS = /(年检|年审|转秘书|秘书|secretar|transfer[\s-]?in|takeover|股份转让|股权转让|转股|增资|扩股|配股|share[\s-]?transfer|allot|incorporat|KYC|CDD|尽职调查|due diligence|RORC|ROND|RONS|实际控制人|受益人|form[\s-]?45|section[\s-]?(?:156|161|386)|notice[\s-]?386|\bS[\s-]?156\b|indemnity|engagement letter|聘用函|承诺书|挂名|董事|dormant|休眠|催款|催缴|付款提醒|chase payment|话术|\bSOP\b)/i;
