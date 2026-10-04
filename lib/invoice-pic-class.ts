// The ONE definition of how an invoice line's PIC (person-in-charge) maps to
// a QuickBooks Class — shared by the Billing Drafts popup's per-line PIC
// column and the create/update invoice routes, so the default a person sees
// is exactly what the server would otherwise apply. Client-safe on purpose:
// no server imports. docs/INVARIANTS.md INV-QB-007 / INV-QB-026.
//
// Real data (2026-10-04): all three books track Class PER LINE
// (Preferences.ClassTrackingPerTxnLine = true) — that is QuickBooks' own
// per-line "Class" column, which Tassure uses as the PIC of each service.

export type PicClassOption = { value: string; name: string };

/** Lines that inherit the company PIC's Class BY DEFAULT (INV-QB-007): Secretary and XBRL only. */
export function requiresPicClass(line: { service: string }): boolean {
  return line.service === 'Secretary' || line.service === 'XBRL';
}

/** Government-fee / disbursement lines carry no PIC class on manual invoices. */
export function isGovFeeLine(l: { service: string; productService?: string }): boolean {
  return l.service === 'AR' || /disbursement|government/i.test(l.productService ?? '');
}

/**
 * Whether a line gets the company PIC's Class when nobody chose one for it:
 * TAB only (TAC's ND lines carry their PIC in the item; TAO lines default to
 * none), Secretary/XBRL only, never a government fee. Unchanged from before
 * the per-line PIC column existed — the column only lets a person override it.
 */
export function getsDefaultPicClass(company: string, line: { service: string; productService?: string }): boolean {
  return company === 'TAB' && requiresPicClass(line) && !isGovFeeLine(line);
}

/**
 * TAO (ACC) lines, as QuickBooks has them — the 60 latest hand-made TAO
 * invoices (2026-10-04): every Accounts/Tax service line carries the PIC's
 * Class (Corporate Tax 39/39, Compilation 13/13, Yearly 11/11, …), while
 * disbursement / expense lines never do (OPE 0/29, Reimbursement Control 0/6).
 */
export function taoLineNeedsPic(line: { service: string }): boolean {
  return line.service === 'Accounts' || line.service === 'Tax';
}

/**
 * The PIC a TAO line starts with — QuickBooks' own setting restored
 * (Vincent, 2026-10-04: "尽量还原QB本来有的设定"): the Class this client's
 * most recent line of the SAME item had; failing that, an Accounts/Tax line
 * takes the client's most recent Class for that service; anything else none.
 * Only a starting value — the person can change it in the PIC column.
 */
export function taoDefaultPicName(
  line: { service: string; productService: string },
  history: { lastClassByProduct: ReadonlyMap<string, string | null>; lastClassByService: Readonly<Record<string, string>> },
): string | null {
  const own = line.productService ? history.lastClassByProduct.get(line.productService) ?? null : null;
  if (own) return own;
  return taoLineNeedsPic(line) ? (history.lastClassByService[line.service] ?? null) : null;
}

/**
 * TAC's Nominee Director PIC lives in the ND service item itself
 * ("Nominee Director Fees - WKX"), never in a Class (INV-QB-007) — such a
 * line never takes a per-line Class. Real data: 0 of 257 TAC ND lines in 2026.
 */
export function picLivesInServiceItem(line: { service: string }): boolean {
  return line.service === 'ND';
}

/**
 * A class name the PIC dropdown offers: a person's full name ("Ang Shi Ming",
 * "To Be Assign"). Since 2026-01-01 every TAB line Class staff typed is one of
 * these; the 2025 initials ("JL", "ASM") and one-off numeric reference classes
 * (3,000+ of TAB's 3,208) are no longer used and are not offered — though a
 * line that still carries one keeps it untouched.
 */
export function isStaffClassName(name: string): boolean {
  return /^[A-Za-z][A-Za-z.'-]*( [A-Za-z][A-Za-z.'-]*)+$/.test(name) && name !== name.toUpperCase();
}

const tokens = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter(Boolean).sort();

/**
 * Match a company PIC ("Shi Ming Ang", possibly "A, B" with several names) to
 * a person class ("Ang Shi Ming") — word-order-insensitive: exact token-set
 * match first, then subset ("Shemin" ⊂ "Tey Shemin"). Candidates are the
 * active, letters-only classes in the order given. Moved verbatim from
 * findPicClass() so the popup's default and the server's are one rule.
 */
export function matchPicClass(classes: readonly { Id: string; Name: string; Active?: boolean }[], pic: string): PicClassOption | null {
  const personClasses = classes.filter(c => c.Active !== false && /^[A-Za-z .'-]+$/.test(c.Name));
  for (const cand of pic.split(/[,/&]| and /i).map(s => s.trim()).filter(Boolean)) {
    const t = tokens(cand);
    if (!t.length) continue;
    const exact = personClasses.find(c => tokens(c.Name).join(' ') === t.join(' '));
    if (exact) return { value: exact.Id, name: exact.Name };
    const subset = personClasses.find(c => { const ct = new Set(tokens(c.Name)); return t.every(x => ct.has(x)); });
    if (subset) return { value: subset.Id, name: subset.Name };
  }
  return null;
}

/**
 * Checks every line's explicit per-line PIC (`picClassId`) against the book's
 * live, active classes. Absent → the default rule applies; null → no PIC;
 * a string → must be an active class of THIS book, and never on a line whose
 * PIC lives in its service item. Returns the classes to reference, or the
 * first problem — never silently drops a chosen PIC.
 */
export function validateLinePicClasses(
  lines: readonly { service: string; description?: string; picClassId?: string | null }[],
  activeClasses: readonly { Id: string; Name: string; Active?: boolean }[],
): { ok: true; classes: Map<string, PicClassOption> } | { ok: false; error: string } {
  const byId = new Map(activeClasses.filter(c => c.Active !== false).map(c => [String(c.Id), { value: String(c.Id), name: c.Name }]));
  const chosen = new Map<string, PicClassOption>();
  for (const l of lines) {
    if (l.picClassId === undefined || l.picClassId === null) continue;
    const label = (l.description ?? l.service).split('\n')[0].slice(0, 60);
    if (picLivesInServiceItem(l)) return { ok: false, error: `"${label}": a Nominee Director line carries its PIC in the ND service item, not a QuickBooks Class.` };
    const hit = byId.get(String(l.picClassId));
    if (!hit) return { ok: false, error: `"${label}": the chosen PIC is not an active QuickBooks Class in this book any more. Reload and pick again.` };
    chosen.set(hit.value, hit);
  }
  return { ok: true, classes: chosen };
}
