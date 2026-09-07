import SectionCard from '@/components/SectionCard';
import AddressServiceTable from '@/components/AddressServiceTable';
import MetricCard from '@/components/MetricCard';
import { supabase } from '@/lib/supabase';
import { ADDRESS_SERVICE_LOCATIONS } from '@/lib/address-service';
import { Building2, Layers3, MapPin } from 'lucide-react';

// Live view of companies.uses_address (kept current by the daily TeamWork
// sync from each company's registered office address) — this page previously
// read a static build-time JSON snapshot and could never reflect changes.
export const dynamic = 'force-dynamic';

async function getData() {
  const { data, error } = await supabase
    .from('companies')
    .select('company_name, registration_no, company_type, pic, best_email, primary_contact, address_service_location')
    .eq('uses_address', true)
    .eq('is_active', true)
    // Secondary key on id: two rows can share the same company_name (e.g.
    // a genuine TeamWork-side duplicate — same UEN, two internal_id's, see
    // GOLDEN BRIDGE MARTEC, 2026-08-27), and Postgres doesn't guarantee a
    // stable relative order between tied sort keys across repeated queries
    // — without this, which row lands in position 109 vs 110 (and thus
    // which "No." each shows) could silently swap between page loads.
    .order('company_name')
    .order('id');
  // Was previously `const { data } = ...` — a real query failure (e.g. a
  // column not existing yet, which address_service_location genuinely was
  // until its own migration ran) silently fell through to `data ?? []` and
  // rendered "0 companies" with no error at all, indistinguishable from a
  // genuinely empty roster. Surface it instead.
  if (error) throw new Error(`Unable to load Address Service companies: ${error.message}`);
  return (data ?? []).map(c => ({
    companyName: c.company_name,
    registrationNo: c.registration_no ?? '',
    companyType: c.company_type ?? '',
    pic: c.pic ?? '',
    bestEmail: c.best_email,
    primaryContact: c.primary_contact as { contactName: string; phone: string } | null,
    addressLocation: c.address_service_location as string | null,
  }));
}

export default async function AddressServicePage() {
  const companies = await getData();

  const byType: Record<string, number> = {};
  companies.forEach(c => {
    const t = c.companyType || 'Unknown';
    byType[t] = (byType[t] || 0) + 1;
  });
  const sortedTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  const topType = sortedTypes[0];

  // Vincent's boss, 2026-09-07 (relayed by Vincent): "Besides our own
  // current office address..., we also use" 4 more real addresses — the
  // single hardcoded "10 Anson Road" metric card this page used to show
  // was only ever true for one of them. Real per-location counts instead —
  // includes an "Unrecognised" bucket for any row where uses_address is
  // true (TeamWork really does show a Tassure-owned address) but the text
  // doesn't match any of our 5 known ones yet (a new location TeamWork
  // hasn't been told about, or an address typo) rather than silently
  // dropping those companies from the breakdown.
  const byLocation = new Map<string, number>();
  let unrecognised = 0;
  for (const c of companies) {
    if (!c.addressLocation) { unrecognised++; continue; }
    byLocation.set(c.addressLocation, (byLocation.get(c.addressLocation) ?? 0) + 1);
  }

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Address Service</div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <MetricCard
          value={companies.length}
          label="Total Address Service Clients"
          sub="active registered-address clients"
          icon={<Building2 size={16} />}
          color="#1d4ed8"
        />
        <MetricCard
          value={sortedTypes.length}
          label="Company Types"
          sub={topType ? `Largest group: ${topType[0]} · ${topType[1]}` : 'No company type data'}
          icon={<Layers3 size={16} />}
          color="#6d28d9"
        />
        <MetricCard
          value={ADDRESS_SERVICE_LOCATIONS.length}
          label="Registered Address Locations"
          sub="office + serviced addresses in use"
          icon={<MapPin size={16} />}
          color="#0f766e"
        />
      </div>

      {/* By location — see comment above on the "Unrecognised" bucket */}
      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: `repeat(${ADDRESS_SERVICE_LOCATIONS.length + (unrecognised ? 1 : 0)}, minmax(0,1fr))` }}>
        {ADDRESS_SERVICE_LOCATIONS.map(loc => (
          <MetricCard
            key={loc.key}
            value={byLocation.get(loc.key) ?? 0}
            label={loc.label.split(',')[0]}
            sub={loc.label.split(',').slice(1).join(',').trim()}
            icon={<MapPin size={14} />}
            color="#0f766e"
          />
        ))}
        {unrecognised > 0 && (
          <MetricCard
            value={unrecognised}
            label="Unrecognised"
            sub="uses_address is true but no address text matched — check TeamWork"
            icon={<MapPin size={14} />}
            color="var(--status-danger)"
          />
        )}
      </div>

      {/* Table — client component so it can paginate (100 rows/page) */}
      <SectionCard title="Companies Using Address Service" count={companies.length}>
        <AddressServiceTable companies={companies} />
      </SectionCard>
    </div>
  );
}
