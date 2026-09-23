// Master List column labels — single source of truth for both the on-screen
// table (components/MasterListTable.tsx) and any server-side export (e.g.
// app/api/master-list/export/route.ts). Kept in its own tiny, framework-free
// file per docs/INVARIANTS.md's INV-DATA-029 model, specifically so an export
// route (plain Node, no 'use client') never needs to duplicate — and risk
// drifting from — labels a 'use client' component file owns.
export type MasterListColumnDef = { field: string; label: string; w: number };

// IMPORTANT: this array is the default for every Master List page that
// doesn't pass an explicit `fields` list — see MasterListTable.tsx's own
// comment on why a column added here appears everywhere.
export const MASTER_LIST_COLUMNS: MasterListColumnDef[] = [
  { field: 'company_name',               label: 'Company Name',    w: 240 },
  { field: 'roc_no',                     label: 'UEN / ROC',       w: 110 },
  { field: 'status',                     label: 'Active',          w: 220 },
  { field: 'internal_code',              label: 'Code',            w: 70  },
  { field: 'update_date',                label: 'Update Date',     w: 100 },
  { field: 'join_date',                  label: 'Join Date',       w: 100 },
  { field: 'sec_agent',                  label: 'Sec Agent',       w: 80  },
  { field: 'kyc_year',                   label: 'KYC Year',        w: 90  },
  { field: 'register_of_controllers',    label: 'ROC',             w: 80  },
  { field: 'corporate_tax',              label: 'Corp Tax',        w: 80  },
  { field: 'efiling_authorization',      label: 'E-filing Auth',   w: 100 },
  { field: 'ac',                         label: 'A/C',             w: 70  },
  { field: 'audit',                      label: 'Audit',           w: 70  },
  { field: 'gst',                        label: 'GST',             w: 70  },
  { field: 'compil_report',              label: 'Compil Report',   w: 100 },
  { field: 'cpf_submit',                 label: 'CPF Submit',      w: 90  },
  { field: 'add_here',                   label: 'Add @',           w: 90  },
  { field: 'invoice_address',            label: 'Invoice/Reg Add', w: 220 },
  { field: 'mailing_address',            label: 'Mailing Add',     w: 220 },
  { field: 'contact_window',             label: 'Contact Window',  w: 140 },
  { field: 'mailing_list',               label: 'Mailing List',    w: 140 },
  { field: 'inc_date',                   label: 'Inc. Date',       w: 100 },
  { field: 'shareholders',               label: 'Shareholders',    w: 200 },
  { field: 'directors',                  label: 'Directors',       w: 200 },
  { field: 'nominee_director',           label: 'Nominee Dir.',    w: 120 },
  { field: 'secretary',                  label: 'Secretary',       w: 130 },
  { field: 'annual_return',              label: 'Annual Return',   w: 110 },
  { field: 'fye',                        label: 'FYE',             w: 180 },
  { field: 'last_ar_date',               label: 'Last AR Date',    w: 110 },
  { field: 'last_agm_date',              label: 'Last AGM Date',   w: 110 },
  { field: 'last_accounts_date',         label: 'Last Accts Date', w: 110 },
  { field: 'next_agm_due_date',          label: 'Next AGM Due',    w: 110 },
  { field: 'months_from_last_accounts',  label: '>13M Accts',      w: 90  },
  { field: 'remark',                     label: 'Remark',          w: 220 },
  { field: 'referral',                   label: 'Referral',        w: 110 },
  { field: 'risk_level',                 label: 'Risk Level',      w: 100 },
  { field: 'incorp_with_us',             label: 'Incorp w/ Us',    w: 100 },
  { field: 'acra_update',                label: 'ACRA Update',     w: 100 },
  { field: 'mas',                        label: 'MAS',             w: 90  },
  { field: 'grade',                      label: 'Grade',           w: 80  },
];

// Derived, page-opt-in-only columns — see MasterListTable.tsx's own comment
// (values come from a server-side join in /api/master-list, not a plain
// master_list column).
export const MASTER_LIST_EXTRA_COLUMNS: MasterListColumnDef[] = [
  { field: 'acc_pic', label: 'ACC', w: 120 },
  { field: 'tax_pic', label: 'TAX', w: 120 },
  { field: 'new_company_name', label: 'New Name', w: 220 },
];
