// Every real Tassure office / serviced-address location a client's
// registered office can be at and still count as "uses our address
// service". Vincent's boss, 2026-09-07 (relayed by Vincent): "Besides our
// own current office address as client registered office address, we also
// use" 4 more real addresses — until this, `usesOurAddress()` only ever
// recognized the first one (10 Anson Road), silently undercounting every
// real client actually registered at one of the other 4 (their own
// `companies.uses_address` flag, and everything downstream of it — the
// Address Service page, AR Reminder, Reports, Company 360, dashboard/stats
// — would all have been missing them).
export interface AddressServiceLocation {
  key: string;
  label: string;
  test: (regAddr: string) => boolean;
}

export const ADDRESS_SERVICE_LOCATIONS: AddressServiceLocation[] = [
  {
    key: 'anson',
    label: '10 Anson Road, #12-08 International Plaza',
    // Original rule, validated 2026-0x against all 319 then-flagged
    // clients (317 matched; the 2 that didn't were genuine cancellations).
    test: a => /10\s+ANSON/i.test(a) && /12-08/.test(a),
  },
  {
    key: 'high_street',
    label: '77 High Street, #08-04 High Street Plaza',
    test: a => /77\s+HIGH\s+STREET/i.test(a) && /08-04/.test(a),
  },
  {
    key: 'paya_lebar',
    label: '60 Paya Lebar Road, #04-32 Paya Lebar Square',
    test: a => /60\s+PAYA\s+LEBAR/i.test(a) && /04-32/.test(a),
  },
  {
    key: 'kallang',
    label: '47 Kallang Pudding Road, #09-10 The Crescent@Kallang',
    test: a => /47\s+KALLANG\s+PUDDING/i.test(a) && /09-10/.test(a),
  },
  {
    key: 'cecil',
    label: '105 Cecil Street, #18-26 The Octagon',
    test: a => /105\s+CECIL/i.test(a) && /18-26/.test(a),
  },
];

// Which of our own locations (if any) this registered-office address text
// matches — checked in the order above, first match wins (the 5 real unit
// numbers are distinct enough that more than one should never match the
// same address, but order is still deterministic if that ever happens).
export function matchOurAddress(regAddr: string): string | null {
  return ADDRESS_SERVICE_LOCATIONS.find(loc => loc.test(regAddr))?.key ?? null;
}

export function usesOurAddress(regAddr: string): boolean {
  return matchOurAddress(regAddr) !== null;
}

export function addressLocationLabel(key: string | null | undefined): string | null {
  if (!key) return null;
  return ADDRESS_SERVICE_LOCATIONS.find(loc => loc.key === key)?.label ?? key;
}
