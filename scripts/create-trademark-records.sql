-- Vincent, 2026-08-25: new "Trademark" section under Master List — two
-- sub-pages, Master Records and In Progress, mirroring the sidebar's
-- existing group/leaf pattern (Active Clients, Strike Off / Terminated).
-- One table with a `category` discriminator, same shape as master_list's
-- own list_type approach, since the two sheets share S/N + company name but
-- otherwise diverge: Master Records has a real IPOS application number +
-- application/expiry dates; In Progress tracks a not-yet-numbered filing by
-- logo/class count + a free-text status + an optional update note instead.
-- Columns only meaningful to one category are simply left NULL on the other.
CREATE TABLE IF NOT EXISTS trademark_records (
  id BIGSERIAL PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('master', 'in_progress')),
  sn INTEGER,
  company_name TEXT NOT NULL,
  application_number TEXT,   -- Master Records only
  application_date DATE,     -- Master Records only
  mark_expired_date DATE,    -- Master Records only
  logo_classes TEXT,         -- In Progress only, e.g. "1 logo, 7 classes"
  status_text TEXT,          -- In Progress only, e.g. "Application on 12/03/2026"
  updates_note TEXT,         -- In Progress only, free text
  row_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ,
  updated_by_email TEXT,
  updated_by_name TEXT
);
CREATE INDEX IF NOT EXISTS trademark_records_category_idx ON trademark_records(category, row_order);

-- Imported from Desktop/TRADEMARK MASTER RECORD.xlsx — 62 Master Records
-- rows + 4 In Progress rows, verbatim (S/N, company name, application
-- number/dates as filed). Two rows worth flagging: S/N 58 "Imin –
-- International trademark - vietnam" has no application number/dates yet in
-- the source file (left NULL, not fabricated); S/N 62 "WAN JIA CATERING...
-- （潮八八现切鸡煲）" appears in BOTH sheets under the same S/N — the source
-- file tracks it as freshly filed in Master Records (application_date
-- 2026-08-25, expiry not yet known) while also still following it through
-- review in In Progress; this is the source data's own intent, not a
-- de-duplication bug — S/N is only sequential within each sheet/category,
-- never a cross-category key.
INSERT INTO trademark_records
  (category, sn, company_name, application_number, application_date, mark_expired_date, logo_classes, status_text, updates_note, row_order)
VALUES
('master', 1, 'GRAND GOLDEN COAST (SINGAPORE) PTE. LTD.', '40201707400Y', '2017-04-26', '2027-04-26', NULL, NULL, NULL, 1),
('master', 2, 'WAN JIA CATERING HOLDING PTE. LTD.', '40201700938S', '2017-01-16', '2027-01-16', NULL, NULL, NULL, 2),
('master', 3, 'FOMO PAY PTE. LTD.', '40201719649Q', '2017-10-06', '2027-10-06', NULL, NULL, NULL, 3),
('master', 4, 'FOMO PAY PTE. LTD.', '40201715605Q', '2017-08-15', '2027-08-15', NULL, NULL, NULL, 4),
('master', 5, 'XI''AN KAKA POWER MACHINERY PTE. LTD.', '40201721856U', '2017-11-06', '2027-11-06', NULL, NULL, NULL, 5),
('master', 6, 'IMIN TECHNOLOGY PTE. LTD.', '40201815989X', '2018-08-13', '2028-08-13', NULL, NULL, NULL, 6),
('master', 7, 'IMIN TECHNOLOGY PTE. LTD.', '40201817289V', '2018-08-30', '2028-08-30', NULL, NULL, NULL, 7),
('master', 8, 'WARMLIGHT PTE. LTD', '40201824217S', '2018-11-22', '2028-11-22', NULL, NULL, NULL, 8),
('master', 9, 'IMIN TECHNOLOGY PTE. LTD.', '40201900540R', '2019-01-08', '2029-01-08', NULL, NULL, NULL, 9),
('master', 10, 'TREE ART INTERNATIONAL PTE. LTD', '40201904154Q', '2019-02-27', '2029-02-27', NULL, NULL, NULL, 10),
('master', 11, 'XIYU COLLECTOR PTE. LTD', '40201923472T', '2019-10-25', '2029-10-25', NULL, NULL, NULL, 11),
('master', 12, 'RONG SHEN PTE. LTD.', '40201926167V', '2019-12-02', '2029-12-02', NULL, NULL, NULL, 12),
('master', 13, 'XIYU COLLECTOR PTE. LTD.', '40202000831R', '2020-01-10', '2030-01-10', NULL, NULL, NULL, 13),
('master', 14, 'XIYU COLLECTOR PTE. LTD.', '40202000832P', '2020-01-10', '2030-01-10', NULL, NULL, NULL, 14),
('master', 15, 'TREE ART INTERNATIONAL PTE. LTD.', '40202020235T', '2020-09-28', '2030-09-28', NULL, NULL, NULL, 15),
('master', 16, 'SU JIHONG', '40202102125Q', '2021-01-25', '2031-01-25', NULL, NULL, NULL, 16),
('master', 17, 'FRONTYARD PTE. LTD.', '40202119869W', '2021-08-18', '2031-08-18', NULL, NULL, NULL, 17),
('master', 18, 'ALTSTAKE TECHNOLOGY PTE. LTD.', '40202126231R', '2021-10-29', '2031-10-29', NULL, NULL, NULL, 18),
('master', 19, 'ACUMEN TECH PTE. LTD.', '40202127074U', '2021-11-11', '2031-11-11', NULL, NULL, NULL, 19),
('master', 20, 'HAPPY BUY TRADING PTE. LTD.', '40202203909V', '2022-02-22', '2032-02-22', NULL, NULL, NULL, 20),
('master', 21, 'TREE ART INTERNATIONAL PTE. LTD.', '40202201222Q', '2022-01-18', '2032-01-18', NULL, NULL, NULL, 21),
('master', 22, 'Hangzhou Jiujiu Xingxuan E-Commerce Co., Ltd.', '40202211767W', '2022-05-24', '2032-05-24', NULL, NULL, NULL, 22),
('master', 23, 'LV YIMIN', '40202250638Q', '2022-06-15', '2032-06-15', NULL, NULL, NULL, 23),
('master', 24, 'HAPPY EVERYONE PTE. LTD.', '40202253161V', '2022-08-05', '2032-08-05', NULL, NULL, NULL, 24),
('master', 25, 'WAN JIA CATERING HOLDING PTE. LTD.', '40202253799D', '2022-08-22', '2032-08-22', NULL, NULL, NULL, 25),
('master', 26, 'MING HING FOOD PTE. LTD.', '40202211013U', '2022-05-13', '2032-05-13', NULL, NULL, NULL, 26),
('master', 27, 'HAITEK INDUSTRIES HOLDING PTE. LTD.', '40202264465Y', '2022-11-25', '2032-11-25', NULL, NULL, NULL, 27),
('master', 28, 'GLORIOUS FUTURE CAPITAL PTE. LTD.', '40202313080X', '2023-06-15', '2033-06-15', NULL, NULL, NULL, 28),
('master', 29, 'FUTURUM SPACE PTE. LTD.', '40202304032S', '2023-02-27', '2033-02-27', NULL, NULL, NULL, 29),
('master', 30, 'FLOOR MELODY PTE. LTD.', '40202319876S', '2023-09-07', '2033-09-07', NULL, NULL, NULL, 30),
('master', 31, 'Shenzhen Broad Link Cultural & Creative Co., Ltd.', '40202324336W', '2023-11-02', '2033-11-02', NULL, NULL, NULL, 31),
('master', 32, 'CREAMO PTE. LTD.', '40202307018Y', '2023-03-30', '2033-03-30', NULL, NULL, NULL, 32),
('master', 33, 'RECCO CONTROL TECHNOLOGY PTE. LTD.', '40202312434Y', '2023-06-08', '2033-06-08', NULL, NULL, NULL, 33),
('master', 34, 'EMPATHY BROTHERHOOD F&B PTE. LTD.', '40202312435X', '2023-06-08', '2033-06-08', NULL, NULL, NULL, 34),
('master', 35, 'YOU BANG PTE. LTD.', '40202401624X', '2024-01-25', '2034-01-25', NULL, NULL, NULL, 35),
('master', 36, 'GLORIOUS FUTURE CAPITAL PTE. LTD.', '40202313081Y', '2023-06-15', '2033-06-15', NULL, NULL, NULL, 36),
('master', 37, 'TASSURE ASIA BIZSERVICES PTE. LTD.', '40202402559T', '2024-02-05', '2034-02-05', NULL, NULL, NULL, 37),
('master', 38, 'VE AESTHETIC PTE. LTD.', '40202402560T', '2024-02-05', '2034-02-05', NULL, NULL, NULL, 38),
('master', 39, 'ARK GRP PTE. LTD.', '40202327692V', '2023-12-14', '2033-12-14', NULL, NULL, NULL, 39),
('master', 40, 'LUXIAOXIAN PTE. LTD.', '40202312433P', '2023-06-08', '2033-06-08', NULL, NULL, NULL, 40),
('master', 41, 'VE AESTHETIC PTE. LTD.', '40202402558S', '2024-02-05', '2034-02-05', NULL, NULL, NULL, 41),
('master', 42, 'WAN JIA CATERING HOLDING PTE. LTD.', '40202324721S', '2023-11-08', '2033-11-08', NULL, NULL, NULL, 42),
('master', 43, 'TAIYAU TRADING PTE. LTD.', '40202406981X', '2024-04-02', '2034-04-02', NULL, NULL, NULL, 43),
('master', 44, 'Canada-ASEAN Business Council', '40202402228V', '2024-02-01', '2034-02-01', NULL, NULL, NULL, 44),
('master', 45, 'TAIYAU TRADING PTE. LTD.', '40202406979U', '2024-04-02', '2034-04-02', NULL, NULL, NULL, 45),
('master', 46, 'TAIYAU TRADING PTE. LTD.', '40202406980U', '2024-04-02', '2034-04-02', NULL, NULL, NULL, 46),
('master', 47, 'TAIYAU TRADING PTE. LTD.', '40202406982V', '2024-04-02', '2034-04-02', NULL, NULL, NULL, 47),
('master', 48, 'HRD FUTURE PTE. LTD.', '40202416705S', '2024-07-25', '2034-07-25', NULL, NULL, NULL, 48),
('master', 49, 'CHAKA HOLDING ', '40202422657Y', '2024-10-02', '2034-10-02', NULL, NULL, NULL, 49),
('master', 50, 'BEAUTI LIFE PTE. LTD. (logo - JIUMEIFU)', '40202427200S', '2024-11-21', '2034-11-21', NULL, NULL, NULL, 50),
('master', 51, 'BEAUTI LIFE PTE. LTD. (word -JIUMEIFU.SG)', '40202427199Q', '2024-11-21', '2034-11-21', NULL, NULL, NULL, 51),
('master', 52, 'DREAM CHASE TECH PTE. LTD - HubDCT', '40202425781P', '2024-11-06', '2034-11-06', NULL, NULL, NULL, 52),
('master', 53, 'Asia Blue Pte.Ltd.', '40202427646Y', '2024-11-25', '2034-11-25', NULL, NULL, NULL, 53),
('master', 54, 'CABC –Word ', '40202402229S', '2024-02-01', '2034-02-01', NULL, NULL, NULL, 54),
('master', 55, 'ASTRATAO PTE. LTD.', '40202501686Q', '2025-01-22', '2035-01-22', NULL, NULL, NULL, 55),
('master', 56, 'WAN JIA CATERING', '40202503361U', '2025-02-13', '2035-02-13', NULL, NULL, NULL, 56),
('master', 57, 'Walnut tech - Sapphire Whale', '40202507835Y', '2025-04-02', '2035-04-02', NULL, NULL, NULL, 57),
('master', 58, 'Imin – International trademark - vietnam', NULL, NULL, NULL, NULL, NULL, NULL, 58),
('master', 59, 'We Grow Academy Group Pte. Ltd (FENG TIANWEI)', '40202528466Q', '2025-11-05', '2035-11-05', NULL, NULL, NULL, 59),
('master', 60, 'AI KING ROBOTICS PTE. LTD.', '40202600482R', '2026-01-08', '2036-01-08', NULL, NULL, NULL, 60),
('master', 61, 'NANTONG YOUZHIYOUMIAN HEALTH MANAGEMENT CO., LTD. （Yoyorelex）', '40202533207R', '2025-12-23', '2035-12-23', NULL, NULL, NULL, 61),
('master', 62, 'WAN JIA CATERING HOLDING PTE. LTD.（潮八八现切鸡煲）', '40202622711P', '2026-08-25', NULL, NULL, NULL, NULL, 62),
('in_progress', 57, 'TERRACOOL', NULL, NULL, NULL, '1 logo, 7 classes', 'Application on 12/03/2026', 'Updates: Publication stage', 1),
('in_progress', 58, 'iHair', NULL, NULL, NULL, '1 logo, 1 class', 'Application on 23/04/2026', NULL, 2),
('in_progress', 61, 'NOVIX AI GLOBAL PTE. LTD.', NULL, NULL, NULL, '1 logo, 4 class', 'Application on 29/07/2026', NULL, 3),
('in_progress', 62, 'WAN JIA CATERING HOLDING PTE. LTD.（潮八八现切鸡煲）', NULL, NULL, NULL, '1 logo, 1 class', 'Application on 25/08/2026', NULL, 4);
