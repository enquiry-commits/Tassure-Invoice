// Customer-source taxonomy for the Reports page (2026-09-03).
//
// `master_list.referral` already existed as a free-text field meant to
// capture this, but turned out unusable: live data showed ~0.3-1% fill
// rate across every list_type, and what little was filled in held a
// person's name (a referring staff/agent), not a channel category — no
// consistent "Website"/"Referral"/"Ad" taxonomy ever existed. A fixed
// dropdown here (companies.customer_source, see
// scripts/add-companies-customer-source.sql) is a deliberate do-over:
// historical rows show "Unknown" until someone tags them, and new/edited
// rows pick from this closed list — never free text again — so the
// Reports source breakdown stays meaningful as it fills in over time.
export type CustomerSource = { value: string; label: string };

export const CUSTOMER_SOURCE_OPTIONS: CustomerSource[] = [
  { value: 'referral', label: 'Referral' },
  { value: 'website', label: 'Website' },
  { value: 'advertising', label: 'Advertising' },
  { value: 'existing_client', label: 'Existing client expansion' },
  { value: 'walk_in', label: 'Walk-in / direct enquiry' },
  { value: 'other', label: 'Other' },
];

const LABEL_BY_VALUE = new Map(CUSTOMER_SOURCE_OPTIONS.map(o => [o.value, o.label]));

export function customerSourceLabel(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  return LABEL_BY_VALUE.get(value) ?? value;
}
