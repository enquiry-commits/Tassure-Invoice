'use client';

import { useState, useRef } from 'react';
import { Plus, Trash2, Loader2, FileSignature, Download } from 'lucide-react';
import type { PostIncorporateCompany, PostIncorporateDirector, PostIncorporateShareholder } from '@/lib/docx-post-incorporate';
import { formatDisplayDate } from '@/lib/date';

const ID_TYPES_DIRECTOR = ['NRIC', 'PASSPORT', 'FIN'];
const ID_TYPES_SHAREHOLDER = ['NRIC', 'PASSPORT', 'FIN', 'UEN'];

// The Bizfile/ACRA extract carries a few fields (Company Type, Primary/
// Secondary Activity, Issued/Paid-Up Capital detail, and each person's
// Date of Appointment/Birth Date/Contact/Email) that none of the 16 real
// Post Incorporate templates actually reference (verified directly against
// the template files) — so they're kept local to this page for display/
// verification parity with the source ACRA document, deliberately NOT part
// of the PostIncorporateCompany/Director/Shareholder types the generate API
// consumes.
type CapitalInfo = { amount: string; numberOfShares: string; currency: string; shareType: string };
type CompanyExtra = { companyType: string; primaryActivity: string; secondaryActivity: string; issuedShareCapital: CapitalInfo; paidUpCapital: CapitalInfo };
type DirectorRow = PostIncorporateDirector & { dateOfAppointment: string };
type ShareholderRow = PostIncorporateShareholder & { dateOfAppointment: string; phone: string; email: string; isRorc: boolean; nationality: string; dateOfBirth: string; currency: string };
type SecretaryRow = { name: string; address: string; identificationType: string; identificationNumber: string; nationality: string; dateOfAppointment: string; dateOfBirth: string; email: string; phone: string };
// TeamWork's own per-person detail (see lib/teamwork-company-profile.ts's
// OfficerDetail) — used both to enrich matched people and to offer adding
// people TeamWork knows about that Bizfile's own result didn't include.
type TeamworkOfficial = { name: string; role: string; address: string; idNo: string; idType: string; dob: string; email: string; mobile: string; telephone: string; subRoles: string };
// From TeamWork's own Shares module (the real, current share register —
// see lib/teamwork-company-profile.ts's fetchShareRegister).
type TeamworkShareholderDetail = { name: string; numberOfShares: string; paidUpCapital: string; currency: string; shareCertificateNo: string };

// Tassure's own registered name — the corporate secretarial firm on every
// Post Incorporate document regardless of client, confirmed against the
// reference desktop app's own output for a real company (its Secretarial
// Firm Address there matched the named Secretary's own parsed Bizfile
// address exactly, since Tassure's appointed secretary staff are based out
// of Tassure's own office — so the address auto-fills from the parsed
// Secretary below rather than being a second hardcoded constant).
const SECRETARY_COMPANY_NAME = 'TASSURE ASIA BIZSERVICES PTE LTD';

// TeamWork's own scraped D.O.B. is "DD/MM/YYYY" text — every <input
// type="date"> on this page needs "YYYY-MM-DD" or the browser just renders
// it blank (silently — no console error, nothing to notice), which is what
// was actually happening every time this auto-fill "worked": the sync had
// real data, but it was never in a format the date input could display.
function teamworkDateToIso(raw: string): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function emptyCompany(): PostIncorporateCompany {
  return {
    name: '', uen: '', address: '', regDate: '', chairmanName: '', secretaryName: '',
    secretaryCompanyName: SECRETARY_COMPANY_NAME, secretaryCompanyAddress: '', currency: 'SGD',
    financialYearEndDayMonth: '', needNdService: false,
  };
}

function emptyCapitalInfo(): CapitalInfo {
  return { amount: '', numberOfShares: '', currency: 'SGD', shareType: 'ORDINARY' };
}

function emptyCompanyExtra(): CompanyExtra {
  return { companyType: '', primaryActivity: '', secondaryActivity: '', issuedShareCapital: emptyCapitalInfo(), paidUpCapital: emptyCapitalInfo() };
}

function emptyDirector(): DirectorRow {
  return {
    name: '', address: '', identificationType: 'NRIC', identificationNumber: '',
    nationality: '', dateOfBirth: '', gender: '', email: '', phone: '', dateOfAppointment: '',
    isNomineeDirector: false, nominatorType: '',
  };
}

function emptySecretary(): SecretaryRow {
  return { name: '', address: '', identificationType: 'NRIC', identificationNumber: '', nationality: '', dateOfAppointment: '', dateOfBirth: '', email: '', phone: '' };
}

function emptyShareholder(): ShareholderRow {
  return {
    name: '', address: '', identificationType: 'NRIC', identificationNumber: '',
    numberOfShares: '', paidUpCapital: '', fullyPaidUp: false, shareCertificateNo: '',
    corporateDirectorNames: [], corpRepresentative: '', corpRepIdType: '', corpRepIdNo: '',
    isNomineeShareholder: false, nominatorType: '',
    dateOfAppointment: '', phone: '', email: '', isRorc: false, nationality: '', dateOfBirth: '', currency: '',
  };
}

// A Nominator (the real person who appointed the ND/nominee shareholder —
// see "08 Declaration of Maintenance of ROND"'s own template text, a letter
// FROM the Nominator TO the company) is very often already one of the
// company's own Directors or Shareholders entered elsewhere in this same
// form (e.g. a controlling shareholder who is also a director requesting
// the ND arrangement). Bizfile itself carries no nominator data at all
// (Vincent: "虽然也能理解 因为bizfile没有nominator信息"), so this can never be
// auto-filled on parse — but picking an existing person here (mirroring
// "jianwei的generate tool是可以选nominator") is much faster than retyping
// their details from scratch. A one-shot copy, not a live link: selecting
// an option just fills the Nominator fields at that moment: the operator
// can still edit them afterward, and nothing stays bound to the source
// person if their own details change later.
type NominatorCandidate = {
  key: string; label: string; name: string; address: string; nationality: string;
  identificationNumber: string; dateOfBirth: string; email: string; phone: string;
};
function nominatorCandidatesFrom(
  directors: DirectorRow[], shareholders: ShareholderRow[], exclude: { kind: 'director' | 'shareholder'; index: number },
): NominatorCandidate[] {
  const out: NominatorCandidate[] = [];
  directors.forEach((d, i) => {
    if (!d.name.trim() || (exclude.kind === 'director' && exclude.index === i)) return;
    out.push({
      key: `director:${i}`, label: `${d.name.trim()} (Director)`, name: d.name, address: d.address,
      nationality: d.nationality, identificationNumber: d.identificationNumber, dateOfBirth: d.dateOfBirth,
      email: d.email, phone: d.phone,
    });
  });
  shareholders.forEach((s, i) => {
    if (!s.name.trim() || (exclude.kind === 'shareholder' && exclude.index === i)) return;
    out.push({
      key: `shareholder:${i}`, label: `${s.name.trim()} (Shareholder)`, name: s.name, address: s.address,
      nationality: s.nationality, identificationNumber: s.identificationNumber, dateOfBirth: s.dateOfBirth,
      email: s.email, phone: s.phone,
    });
  });
  return out;
}
// Fields a picked candidate can actually supply — Date Became Nominator has
// no source anywhere (it's a new fact: WHEN this person became the
// nominator, not derivable from their director/shareholder appointment
// date), so it's always left for manual entry.
type NominatorFillTarget = {
  nominatorIndName?: string; nominatorIndAddress?: string; nominatorIndNationality?: string;
  nominatorIndIdentificationNumber?: string; nominatorIndBirthDate?: string; nominatorIndEmail?: string;
  nominatorIndContactNumber?: string;
};
function nominatorFillFrom(c: NominatorCandidate): NominatorFillTarget {
  return {
    nominatorIndName: c.name, nominatorIndAddress: c.address, nominatorIndNationality: c.nationality,
    nominatorIndIdentificationNumber: c.identificationNumber, nominatorIndBirthDate: c.dateOfBirth,
    nominatorIndEmail: c.email, nominatorIndContactNumber: c.phone,
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-[13px] text-slate-600">{label}</span>
      {children}
    </label>
  );
}

// Vincent, 2026-09-11: "全部的日期只显示...21 August 2026...不显示...21/8/2026"
// — the native <input type="date"> picker's own displayed text is entirely
// browser/OS-locale-controlled, no way for app code to reformat it (that
// was already true for Incorporation Date, previously the only field with
// this treatment). Every date field on this page now shows the same
// spelled-out format used everywhere else in the system and in the
// generated documents right next to the native picker — the picker itself
// stays, since it's still needed for calendar-click editing and every date
// field/formula/generated document requires the underlying ISO value.
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input type="date" className={inputClass} value={value} onChange={e => onChange(e.target.value)} />
        {value && <span className="text-xs text-slate-500 whitespace-nowrap">{formatDisplayDate(value)}</span>}
      </div>
    </Field>
  );
}

const inputClass = 'rounded-md border border-slate-300 bg-white px-2.5 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';
const cardClass = 'rounded-xl border border-slate-200 bg-[#fafafa] p-5 shadow-md';
const sectionTitleClass = 'text-base font-semibold text-slate-800 mb-4';
// Full-width tab bar matching the reference app's native tab control: the
// active tab pops forward in white, the inactive tab and the empty filler
// space both sit flush in the same light background bar. Vincent
// color-picked the reference's exact bar color: "背景条的颜色是（#e4e9ef）"
// (the first guess, a saturated steel-blue, was too dark). Reused for the
// per-person Director/Secretary/Shareholder tabs too, per Vincent's later
// request to switch those from table rows to a tab-per-person + full-form
// layout ("改成每个人一个Tab+完整表单") — matching the reference app's own
// screens exactly, rather than inventing a third tab style.
const tabClass = (active: boolean) => `px-5 py-2 text-sm font-medium border border-slate-300 ${active ? 'bg-[#1d395e] border-[#1d395e] text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`;
const addRowButtonClass = 'flex items-center gap-1.5 rounded-md border border-slate-400 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 text-sm font-medium px-3.5 py-1.5 shadow-sm';

// Every "是否..." (yes/no) field in the reference app is a dropdown, not a
// checkbox — matches its own screens exactly rather than the checkbox
// shorthand used before the per-person tab redesign.
function YesNoField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Field label={label}>
      <select className={inputClass} value={value ? 'YES' : 'NO'} onChange={e => onChange(e.target.value === 'YES')}>
        <option value="NO">NO</option>
        <option value="YES">YES</option>
      </select>
    </Field>
  );
}

export default function PostIncorporatePage() {
  const [company, setCompany] = useState<PostIncorporateCompany>(emptyCompany());
  const [companyExtra, setCompanyExtra] = useState<CompanyExtra>(emptyCompanyExtra());
  const [capitalTab, setCapitalTab] = useState<'issued' | 'paidUp'>('issued');
  const [directors, setDirectors] = useState<DirectorRow[]>([emptyDirector()]);
  const [secretaries, setSecretaries] = useState<SecretaryRow[]>([emptySecretary()]);
  const [shareholders, setShareholders] = useState<ShareholderRow[]>([emptyShareholder()]);
  // Which person's tab is open per section — clamped at render time rather
  // than kept perfectly in sync on every add/remove/Bizfile-reset, since a
  // stale index just needs to fall back to the last valid one, never crash.
  const [activeDirectorTab, setActiveDirectorTab] = useState(0);
  const [activeSecretaryTab, setActiveSecretaryTab] = useState(0);
  const [activeShareholderTab, setActiveShareholderTab] = useState(0);
  // People TeamWork's own records show for this company that Bizfile's
  // parsed result didn't include — Vincent: "系统只会从BIZFILE读取一个人...
  // 因此我要你从TW做比对，并且当系统从BIZFILE检测出来的结构和TW的不同要跳出
  // 弹窗提示是否要修改." null = no check run yet or nothing to flag.
  const [missingFromBizfile, setMissingFromBizfile] = useState<{ directors: TeamworkOfficial[]; secretaries: TeamworkOfficial[]; shareholderNames: string[] } | null>(null);
  // Uppercased names from Tassure's own 13-person ND roster (nominee_
  // directors) matched for the currently-parsed company — kept at page
  // level, not just inside the parse handler, so the "Nominee Director
  // details" panel gates correctly even for a director added/renamed after
  // the initial parse, not only the exact rows the parse itself touched.
  // "是否为名义董事" (is this director a nominee at all — from either Bizfile's
  // own ND marker or this same roster) is a different, broader question;
  // this set specifically answers "does Tassure supply THIS one," per
  // Vincent: "这个是只针对当秘书提供ND服务...这两个属于不同的东西".
  const [tassureNdNames, setTassureNdNames] = useState<Set<string>>(new Set());
  // Kept at page level (not just a local var inside the parse handler) so
  // addMissingShareholder can look up a name's real address/ID/dob/email/
  // mobile — the share register missingShareholderNames comes from is just
  // names, but the same person is very likely also in this map now that
  // sync-secretary persists individual shareholders' own detail cards too.
  const [teamworkOfficialByName, setTeamworkOfficialByName] = useState<Map<string, TeamworkOfficial>>(new Map());
  // Same idea, but for TeamWork's own Shares module data (Number of
  // Shares/Paid-Up Capital/Share Certificate No./currency) — Bizfile has no
  // source for Paid-Up Capital or Share Certificate No. at all, and per
  // Vincent this module is the accurate, CURRENT register (unlike the
  // company profile page's own "Shareholders Information" table, confirmed
  // stale): "这个TW页面就有准确的shareholder的paidup capital."
  const [teamworkShareholderByName, setTeamworkShareholderByName] = useState<Map<string, TeamworkShareholderDetail>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [success, setSuccess] = useState<string | null>(null);
  const [bizfileParsed, setBizfileParsed] = useState(false);

  const updateDirector = (index: number, patch: Partial<DirectorRow>) =>
    setDirectors(current => current.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const updateSecretary = (index: number, patch: Partial<SecretaryRow>) =>
    setSecretaries(current => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const updateShareholder = (index: number, patch: Partial<ShareholderRow>) =>
    setShareholders(current => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  const [bizfileLoading, setBizfileLoading] = useState(false);
  const [bizfileMessage, setBizfileMessage] = useState<string | null>(null);
  // Drag-and-drop for the Bizfile PDF — Vincent, 2026-09-11: "不是只有第一
  // 板块 Drag PDF，而是整个页面，只要拖到这个页面就可以了没有限制是背景还是
  // 什么板块" (not just the upload card — the WHOLE page, background
  // included, is a drop target). The handlers live on the page's own
  // top-level wrapper below, not on the small upload card.
  //
  // A plain onDragLeave (the pattern My Tasks' own attachment drop zone
  // uses, fine for one small box) flickers badly once the drop target is
  // the whole page: it fires every time the pointer crosses into a nested
  // child element, not just when it actually leaves the page. A dragenter/
  // dragleave counter is the standard fix — increment on enter, decrement
  // on leave, only clear the active state at zero.
  const [bizfileDragActive, setBizfileDragActive] = useState(false);
  const bizfileDragDepth = useRef(0);
  const onPageDragEnter = (e: React.DragEvent) => {
    if (bizfileLoading || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    bizfileDragDepth.current += 1;
    setBizfileDragActive(true);
  };
  const onPageDragOver = (e: React.DragEvent) => {
    if (bizfileLoading || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); // required on every dragover, or the browser refuses the drop
  };
  const onPageDragLeave = (e: React.DragEvent) => {
    if (bizfileLoading) return;
    e.preventDefault();
    bizfileDragDepth.current = Math.max(0, bizfileDragDepth.current - 1);
    if (bizfileDragDepth.current === 0) setBizfileDragActive(false);
  };
  const onPageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    bizfileDragDepth.current = 0;
    setBizfileDragActive(false);
    if (bizfileLoading) return;
    const f = [...e.dataTransfer.files].find(file => file.type === 'application/pdf');
    if (f) handleBizfileUpload(f);
    else if (e.dataTransfer.files?.[0]) setBizfileMessage('That file is not a PDF — drop the Bizfile PDF instead.');
  };

  async function handleBizfileUpload(file: File) {
    setBizfileLoading(true);
    setBizfileMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/post-incorporate/parse-bizfile', { method: 'POST', body: formData });
      const body = await res.json();
      if (!res.ok) { setBizfileMessage(body.error || 'Could not parse this PDF.'); return; }

      setCompany(current => ({
        ...current,
        name: body.company.name || current.name,
        uen: body.company.uen || current.uen,
        regDate: body.company.regDate || current.regDate,
        address: body.company.address || current.address,
        secretaryName: body.company.secretaryName || current.secretaryName,
        // Tassure's appointed secretary staff are based out of Tassure's own
        // office, so the secretarial firm's own address is, in practice, the
        // named Secretary's own on-file address — confirmed against a real
        // reference example rather than assumed.
        secretaryCompanyAddress: body.secretary?.address || current.secretaryCompanyAddress,
      }));
      if (body.extra) {
        setCompanyExtra({
          companyType: body.extra.companyType || '',
          primaryActivity: body.extra.primaryActivity || '',
          secondaryActivity: body.extra.secondaryActivity || '',
          issuedShareCapital: { ...emptyCapitalInfo(), ...body.extra.issuedShareCapital },
          paidUpCapital: { ...emptyCapitalInfo(), ...body.extra.paidUpCapital },
        });
      }
      const bfDirectors = (body.directors || []) as { name: string; address: string; identificationType: string; identificationNumber: string; nationality: string; dateOfAppointment: string; isNomineeDirector: boolean }[];
      const bfShareholders = (body.shareholders || []) as { name: string; address: string; identificationType: string; identificationNumber: string; nationality: string; numberOfShares: string; currency: string }[];

      // Bizfile is the official ACRA extract — it doesn't carry FYE (a
      // TeamWork/Tassure-tracked concept, not an ACRA one), nominee-director
      // status (Tassure's own nd_appointments roster), or per-person Birth
      // Date/Email/Mobile (TeamWork's own detail cards — see
      // lib/teamwork-company-profile.ts). All already sit in Supabase from
      // other nightly syncs, so fetch them now rather than leaving fields
      // empty the system genuinely already has an answer for — Vincent:
      // "这些资料在 TW其实都可以拿到，你之前也拿到了，只是我现在要你填写
      // 进去系统内的空格."
      let enrichedFye = '';
      let nomineeDirectorNames: string[] = [];
      let teamworkOfficials: TeamworkOfficial[] = [];
      let teamworkShareholderNames: string[] = [];
      let teamworkShareholderDetails: TeamworkShareholderDetail[] = [];
      try {
        const enrichRes = await fetch(`/api/post-incorporate/enrich?uen=${encodeURIComponent(body.company.uen || '')}&company=${encodeURIComponent(body.company.name || '')}`);
        if (enrichRes.ok) {
          const enrichBody = await enrichRes.json();
          enrichedFye = enrichBody.financialYearEndDayMonth || '';
          nomineeDirectorNames = enrichBody.nomineeDirectorNames || [];
          // nomineeDirectorDetails (the ND's OWN bio from Tassure's roster)
          // is intentionally not consumed here anymore — it was previously
          // (wrongly) used to auto-fill the Nominator fields with the ND's
          // own info; see the note where directors are built below for why.
          teamworkOfficials = enrichBody.teamworkOfficials || [];
          teamworkShareholderNames = enrichBody.teamworkShareholderNames || [];
          teamworkShareholderDetails = enrichBody.teamworkShareholderDetails || [];
        }
      } catch { /* enrichment is a nice-to-have; a failure here shouldn't block the Bizfile result itself */ }
      const officialByName = new Map(teamworkOfficials.map(o => [o.name.trim().toUpperCase(), o]));
      const shareholderDetailByName = new Map(teamworkShareholderDetails.map(s => [s.name.trim().toUpperCase(), s]));
      setTassureNdNames(new Set(nomineeDirectorNames));
      setTeamworkOfficialByName(officialByName);
      setTeamworkShareholderByName(shareholderDetailByName);

      if (body.secretary) {
        const match = officialByName.get((body.secretary.name || '').trim().toUpperCase());
        setSecretaries([{
          name: body.secretary.name || '', address: body.secretary.address || '',
          identificationType: body.secretary.identificationType || 'NRIC',
          identificationNumber: body.secretary.identificationNumber || '',
          nationality: body.secretary.nationality || '', dateOfAppointment: body.secretary.dateOfAppointment || '',
          dateOfBirth: teamworkDateToIso(match?.dob || ''), email: match?.email || '', phone: match?.mobile || '',
        }]);
        setActiveSecretaryTab(0);
      }

      if (bfDirectors.length) {
        // "是否为名义董事" (is THIS director a nominee) and "是否需提供ND服务"
        // (does Tassure's secretarial firm need to PROVIDE that ND service)
        // are different questions, per Vincent's explicit correction: a
        // director can be a nominee director without Tassure being the one
        // supplying that arrangement. The per-director flag takes either
        // signal — Tassure's own nd_appointments roster, or ACRA's own "ND"
        // marker on the Bizfile extract itself (neither is strictly more
        // authoritative; a real case showed the roster missing someone the
        // Bizfile had right: "ZHANG LIN那边都有标记他是ND了...是否为名义董事那边
        // 是YES"). But whether Tassure needs to PROVIDE the service can only
        // come from Tassure's own roster — specifically nominee_directors,
        // Vincent's fixed roster of 13 named individuals Tassure supplies as
        // ND-for-hire ("我原定的13人") — Bizfile's own marker says nothing
        // about who is actually supplying the arrangement, so it must NOT
        // feed this company-level flag ("DIRECTOR是ND，不代表需要秘书公司有
        // 提供ND服务...这两个属于不同的东西").
        const isNomineeDirector = (d: typeof bfDirectors[number]) =>
          d.isNomineeDirector || nomineeDirectorNames.includes(d.name.trim().toUpperCase());
        const anyTassureSuppliedNd = bfDirectors.some(d => nomineeDirectorNames.includes(d.name.trim().toUpperCase()));
        setCompany(current => ({ ...current, needNdService: anyTassureSuppliedNd }));
        setDirectors(bfDirectors.map(d => {
          const isNominee = isNomineeDirector(d);
          const match = officialByName.get(d.name.trim().toUpperCase());
          return {
            ...emptyDirector(), name: d.name, address: d.address, identificationType: d.identificationType || 'NRIC',
            identificationNumber: d.identificationNumber, nationality: d.nationality, dateOfAppointment: d.dateOfAppointment || '',
            dateOfBirth: teamworkDateToIso(match?.dob || ''), email: match?.email || '', phone: match?.mobile || '',
            isNomineeDirector: isNominee, nominatorType: isNominee ? 'individual' : '',
            // The Nominator is a genuinely SEPARATE real person from the ND
            // — confirmed directly from "08 Declaration of Maintenance of
            // ROND"'s own template text: the Nominator's block is a letter
            // FROM the Nominator TO the company ("I, the undersigned, have
            // appointed a nominee director of the Company..."), signed by
            // the Nominator in their OWN capacity (often "Director", since
            // the real nominator is very often another director/shareholder
            // of the same company who requested the ND arrangement — NOT
            // because the nominator "is" the ND). A previous version of this
            // code read `signature_position: 'Director'` backwards and
            // auto-filled these fields with the ND's OWN bio
            // (nominatorIndName: d.name) — confidently wrong data is worse
            // than a blank field here, and Vincent confirmed this was a real
            // misunderstanding baked in from early on ("我之前一直误解了我把
            // ND 当成是 NOMINATOR"). Bizfile genuinely has no nominator
            // data (Vincent: "虽然也能理解 因为bizfile没有nominator信息") —
            // left blank for manual entry (or the "Quick-fill Nominator
            // from…" picker below, which copies from an already-entered
            // Director/Shareholder — the real nominator is very often
            // already one of them).
          };
        }));
        setActiveDirectorTab(0);
        // Chairman isn't a field ACRA's Bizfile extract carries at all —
        // there's no reliable way to know who's chairman when there are
        // multiple directors, so this only auto-fills the unambiguous
        // case: exactly one director parsed. Otherwise it's left for
        // staff to pick, same as before.
        if (bfDirectors.length === 1) {
          setCompany(current => ({ ...current, chairmanName: bfDirectors[0].name }));
        }
      }
      if (bfShareholders.length) {
        setShareholders(bfShareholders.map(s => {
          const match = officialByName.get(s.name.trim().toUpperCase());
          // Paid-Up Capital / Share Certificate No. have no Bizfile source
          // at all — Bizfile's own Number of Shares/currency stay
          // authoritative (never overwritten by TeamWork here), but these
          // two only ever come from TeamWork's Shares module.
          const shareDetail = shareholderDetailByName.get(s.name.trim().toUpperCase());
          return {
            ...emptyShareholder(), name: s.name, address: s.address, identificationType: s.identificationType || 'NRIC',
            identificationNumber: s.identificationNumber, nationality: s.nationality || '', numberOfShares: s.numberOfShares,
            currency: s.currency || '',
            paidUpCapital: shareDetail?.paidUpCapital || '', shareCertificateNo: shareDetail?.shareCertificateNo || '',
            dateOfBirth: teamworkDateToIso(match?.dob || ''), email: match?.email || '', phone: match?.mobile || '',
          };
        }));
        setActiveShareholderTab(0);
      }
      if (enrichedFye) setCompany(current => ({ ...current, financialYearEndDayMonth: enrichedFye }));
      const nomineeDirectorCount = bfDirectors.filter(d => d.isNomineeDirector || nomineeDirectorNames.includes(d.name.trim().toUpperCase())).length;

      // TeamWork-known people in a role Bizfile's own result didn't include
      // at all — e.g. a company with two directors where only one made it
      // into this parse. Bizfile's own extractor already loops over every
      // ID-anchored row it finds rather than assuming exactly one person
      // (verified by reading lib/bizfile-parse.ts), so this is a genuine
      // cross-check against a second source, not a known single-person
      // limitation being patched over here.
      const directorNamesFound = new Set(bfDirectors.map(d => d.name.trim().toUpperCase()));
      const missingDirectors = teamworkOfficials.filter(o => o.role === 'Director' && !directorNamesFound.has(o.name.trim().toUpperCase()));
      const secretaryNamesFound = new Set(body.secretary ? [(body.secretary.name || '').trim().toUpperCase()] : []);
      const missingSecretaries = teamworkOfficials.filter(o => o.role === 'Secretary' && !secretaryNamesFound.has(o.name.trim().toUpperCase()));
      const shareholderNamesFound = new Set(bfShareholders.map(s => s.name.trim().toUpperCase()));
      const missingShareholderNames = teamworkShareholderNames.filter(n => !shareholderNamesFound.has(n));
      setMissingFromBizfile(
        missingDirectors.length || missingSecretaries.length || missingShareholderNames.length
          ? { directors: missingDirectors, secretaries: missingSecretaries, shareholderNames: missingShareholderNames }
          : null,
      );

      setBizfileParsed(true);
      const ndNote = nomineeDirectorCount ? ` ${nomineeDirectorCount} nominee director(s) auto-detected (Tassure's ND roster and/or ACRA's own "ND" marker on the Bizfile).` : '';
      const contactNote = teamworkOfficials.length ? ' Birth Date/Email/Contact filled in from TeamWork where a name matched.' : '';
      const missingNote = (missingDirectors.length || missingSecretaries.length || missingShareholderNames.length)
        ? ' TeamWork shows people in these roles that this Bizfile parse didn’t include — see the popup to add them.' : '';
      setBizfileMessage(`Parsed from Bizfile: company info, ${bfDirectors.length} director(s), ${bfShareholders.length} shareholder(s) pre-filled.${enrichedFye ? ' FYE filled from existing records.' : ''}${ndNote}${contactNote}${missingNote} This is the official ACRA extract — still verify before generating (Nominee Shareholder status still needs manual entry; TeamWork contact fields are best-effort and worth a second look).`);
    } catch (error) {
      setBizfileMessage(error instanceof Error ? error.message : 'Unexpected error parsing the PDF.');
    } finally {
      setBizfileLoading(false);
    }
  }

  function addMissingDirector(o: TeamworkOfficial) {
    setDirectors(current => [...current, {
      ...emptyDirector(), name: o.name, address: o.address,
      identificationType: o.idType || 'NRIC', identificationNumber: o.idNo,
      dateOfBirth: teamworkDateToIso(o.dob), email: o.email, phone: o.mobile,
    }]);
    setActiveDirectorTab(directors.length);
    setMissingFromBizfile(current => current && { ...current, directors: current.directors.filter(d => d !== o) });
  }
  function addMissingSecretary(o: TeamworkOfficial) {
    setSecretaries(current => [...current, {
      ...emptySecretary(), name: o.name, address: o.address,
      identificationType: o.idType || 'NRIC', identificationNumber: o.idNo,
      dateOfBirth: teamworkDateToIso(o.dob), email: o.email, phone: o.mobile,
    }]);
    setActiveSecretaryTab(secretaries.length);
    setMissingFromBizfile(current => current && { ...current, secretaries: current.secretaries.filter(s => s !== o) });
  }
  function addMissingShareholder(name: string) {
    // missingShareholderNames comes from the same share register
    // (teamworkShareholderNames) that teamworkShareholderByName's richer
    // per-person detail is keyed from — so the same name resolves to real
    // Number of Shares/Paid-Up Capital/Share Certificate No./currency, not
    // just a bare name. Individual bio fields (address/ID/dob/email/
    // mobile) come from teamworkOfficialByName instead, now that
    // sync-secretary also persists individual shareholders' own
    // Shareholders-tab cards (role: 'Shareholder').
    const match = teamworkOfficialByName.get(name.trim().toUpperCase());
    const shareDetail = teamworkShareholderByName.get(name.trim().toUpperCase());
    setShareholders(current => [...current, {
      ...emptyShareholder(), name,
      address: match?.address || '', identificationType: match?.idType || 'NRIC', identificationNumber: match?.idNo || '',
      dateOfBirth: teamworkDateToIso(match?.dob || ''), email: match?.email || '', phone: match?.mobile || '',
      numberOfShares: shareDetail?.numberOfShares || '', currency: shareDetail?.currency || '',
      paidUpCapital: shareDetail?.paidUpCapital || '', shareCertificateNo: shareDetail?.shareCertificateNo || '',
    }]);
    setActiveShareholderTab(shareholders.length);
    setMissingFromBizfile(current => current && { ...current, shareholderNames: current.shareholderNames.filter(n => n !== name) });
  }

  async function handleSubmit() {
    setErrors([]);
    setSuccess(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/post-incorporate/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, directors, shareholders }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
        setErrors([body.error || `Request failed (${res.status})`]);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match ? match[1] : `${company.name || 'Post-Incorporate'}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSuccess(`Generated and downloaded "${filename}". File it into the client's network folder.`);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Unexpected error generating documents.']);
    } finally {
      setSubmitting(false);
    }
  }

  const parsedSuffix = bizfileParsed ? <span className="text-xs font-normal text-slate-400 ml-1.5">(来自Bizfile解析)</span> : null;
  const activeCapital = capitalTab === 'issued' ? companyExtra.issuedShareCapital : companyExtra.paidUpCapital;
  const setActiveCapital = (patch: Partial<CapitalInfo>) =>
    setCompanyExtra(current => ({
      ...current,
      [capitalTab === 'issued' ? 'issuedShareCapital' : 'paidUpCapital']: { ...activeCapital, ...patch },
    }));

  return (
    <>
    <div
      className="p-6 max-w-[1500px] mx-auto flex flex-col gap-7 relative"
      onDragEnter={onPageDragEnter}
      onDragOver={onPageDragOver}
      onDragLeave={onPageDragLeave}
      onDrop={onPageDrop}
    >
      {/* Whole-page drop overlay — Vincent: drop the Bizfile PDF anywhere on
          the page, background included, not just the upload card. This is
          the only visible feedback once the drop target isn't one small
          box anymore, so it has to say plainly that anywhere is fine. */}
      {bizfileDragActive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-blue-900/10 border-4 border-dashed border-blue-400 pointer-events-none">
          <div className="bg-white rounded-lg shadow-xl px-6 py-4 flex items-center gap-3">
            <FileSignature size={20} className="text-blue-600" />
            <span className="text-sm font-medium text-slate-700">松开即可上传 Bizfile PDF（页面任意位置均可拖放）</span>
          </div>
        </div>
      )}
      <div className="mb-1 text-sm text-slate-500">Dashboard › Post Incorporate</div>
      <div className="flex items-center gap-2">
        <FileSignature size={22} className="text-blue-600" />
        <h1 className="text-xl font-semibold text-slate-800">Post Incorporate — Tassure Document Generator</h1>
      </div>
      <p className="text-sm text-slate-500 -mt-3">
        Fills the Post Incorporate (Tassure) document set from the details below and downloads a ZIP.
        Staff then file the ZIP's contents into the client's network folder manually, as usual.
      </p>

      {/* Bizfile upload */}
      <section className={cardClass}>
        <div className={sectionTitleClass}>Auto-fill from Bizfile PDF (recommended)</div>
        <p className="text-sm text-slate-500 -mt-2 mb-3">
          Upload the company&apos;s ACRA Bizfile Business Profile (text-based PDF, not a scan) to pre-fill company info,
          Directors, and Shareholders directly from the official registry extract.
        </p>
        <div className="w-fit">
          <label className="flex items-center gap-2 rounded-md bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium px-4 py-2 w-fit cursor-pointer">
            {bizfileLoading ? <Loader2 size={14} className="animate-spin" /> : <FileSignature size={14} />}
            {bizfileLoading ? 'Parsing…' : 'Upload Bizfile PDF'}
            <input type="file" accept="application/pdf" className="hidden" disabled={bizfileLoading}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleBizfileUpload(f); e.target.value = ''; }} />
          </label>
          <p className="text-xs text-slate-400 mt-1.5">or drag a PDF anywhere on this page</p>
        </div>
        {bizfileMessage && <p className="text-sm text-slate-500 mt-2">{bizfileMessage}</p>}
      </section>

      {/* Company */}
      <section className={cardClass}>
        <div className={sectionTitleClass}>Company Information 公司信息</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Company Name 企业名称"><input className={inputClass} value={company.name} onChange={e => setCompany({ ...company, name: e.target.value })} /></Field>
          <Field label="Company UEN 公司注册编号"><input className={inputClass} value={company.uen} onChange={e => setCompany({ ...company, uen: e.target.value })} /></Field>
          <DateField label="Incorporation Date 成立日期" value={company.regDate} onChange={v => setCompany({ ...company, regDate: v })} />
          <Field label="Company Type 公司类型"><input className={inputClass} value={companyExtra.companyType} onChange={e => setCompanyExtra({ ...companyExtra, companyType: e.target.value })} /></Field>
        </div>

        <div className="mt-5">
          <div className="text-sm font-medium text-slate-600 mb-2">Capital 股本信息</div>
          <div className="flex bg-[#e4e9ef] rounded-t-md overflow-hidden">
            <button type="button" className={tabClass(capitalTab === 'issued')} onClick={() => setCapitalTab('issued')}>Issued Share Capital</button>
            <button type="button" className={tabClass(capitalTab === 'paidUp')} onClick={() => setCapitalTab('paidUp')}>Paid-Up Capital</button>
            <div className="flex-1" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 rounded-b-md bg-white border border-t-0 border-slate-300 p-4 relative">
            <Field label="Amount 金额"><input className={inputClass} value={activeCapital.amount} onChange={e => setActiveCapital({ amount: e.target.value })} /></Field>
            <Field label="Number of Shares 股份数量"><input className={inputClass} value={activeCapital.numberOfShares} onChange={e => setActiveCapital({ numberOfShares: e.target.value })} /></Field>
            <Field label="Currency 币种"><input className={inputClass} value={activeCapital.currency} onChange={e => setActiveCapital({ currency: e.target.value })} /></Field>
            <Field label="Share Type 股份类型"><input className={inputClass} value={activeCapital.shareType} onChange={e => setActiveCapital({ shareType: e.target.value })} /></Field>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 mt-4">
          <Field label="Company Address 公司注册地址"><input className={inputClass} value={company.address} onChange={e => setCompany({ ...company, address: e.target.value })} /></Field>
          <Field label="Primary Activity 主营业务"><input className={inputClass} value={companyExtra.primaryActivity} onChange={e => setCompanyExtra({ ...companyExtra, primaryActivity: e.target.value })} /></Field>
          <Field label="Secondary Activity 副营业务"><input className={inputClass} value={companyExtra.secondaryActivity} onChange={e => setCompanyExtra({ ...companyExtra, secondaryActivity: e.target.value })} /></Field>
        </div>
      </section>

      {/* Fields the templates actually consume but aren't part of ACRA's own
          Company Information page — Vincent: "这个单独一张卡片" (own card,
          was a divided sub-section within Company Information before). */}
      <section className={cardClass}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Secretarial Firm Name 秘书公司"><input className={inputClass} value={company.secretaryCompanyName} onChange={e => setCompany({ ...company, secretaryCompanyName: e.target.value })} /></Field>
          <Field label="Secretarial Firm Address 秘书公司地址"><input className={inputClass} value={company.secretaryCompanyAddress} onChange={e => setCompany({ ...company, secretaryCompanyAddress: e.target.value })} /></Field>
          <Field label="Currency (for documents)"><input className={inputClass} value={company.currency} onChange={e => setCompany({ ...company, currency: e.target.value })} /></Field>
          <Field label="Financial Year End Day and Month(DD/MM)"><input className={inputClass} value={company.financialYearEndDayMonth} onChange={e => setCompany({ ...company, financialYearEndDayMonth: e.target.value })} /></Field>
          <YesNoField label="是否需提供ND服务" value={company.needNdService} onChange={v => setCompany({ ...company, needNdService: v })} />
          {/* Vincent, 2026-09-11: "在我小程序里面是有一个这个东西的，但是在我
              系统不见了" — the ND Agreement template names only this ONE
              shareholder as "the Shareholder" party (ported from the old
              desktop tool's "最大股东" selector); the other shareholders are
              unaffected, they still each get their own signature block.
              Leaving this on "自动" keeps the old tool's default (whoever
              holds the most shares) computed server-side at generation time
              — pick a name here only to override that default. */}
          {company.needNdService && (
            <Field label="最大股东 Largest Shareholder">
              <select className={inputClass} value={company.largestShareholderName || ''} onChange={e => setCompany({ ...company, largestShareholderName: e.target.value })}>
                <option value="">自动（持股最多的股东）</option>
                {shareholders.filter(s => s.name.trim()).map(s => (
                  <option key={s.name} value={s.name.trim()}>{s.name.trim()}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </section>

      {/* Directors */}
      <section className={cardClass}>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
          <div className={`${sectionTitleClass} mb-0`}>董事 Directors{parsedSuffix}</div>
          <button type="button" onClick={() => { setDirectors([...directors, emptyDirector()]); setActiveDirectorTab(directors.length); }}
            className={addRowButtonClass}>
            <Plus size={15} /> 新增一行 Add Row
          </button>
        </div>
        <div className="flex items-center gap-2 text-sm mb-3">
          <span className="font-medium text-slate-600">Chairman 主席</span>
          <select className={inputClass} value={company.chairmanName} onChange={e => setCompany({ ...company, chairmanName: e.target.value })}>
            <option value="">—</option>
            {directors.filter(d => d.name.trim()).map((d, idx) => <option key={idx} value={d.name}>{d.name}</option>)}
          </select>
        </div>
        {(() => {
          const di = Math.min(activeDirectorTab, directors.length - 1);
          const d = directors[di];
          // "是否为名义董事" alone isn't enough to show the nominator sub-panel
          // — that also requires Tassure itself to be the one supplying this
          // specific director's ND arrangement (tassureNdNames), otherwise
          // Tassure has no nominator bio on file to ask staff to confirm.
          const isTassureNd = tassureNdNames.has(d.name.trim().toUpperCase());
          return (
            <>
              <div className="flex gap-1 overflow-x-auto">
                {directors.map((dd, i) => (
                  <button key={i} type="button" className={tabClass(i === di)} onClick={() => setActiveDirectorTab(i)}>
                    {dd.name.trim() || `Director ${i + 1}`}
                  </button>
                ))}
              </div>
              <div className="border border-slate-300 border-t-0 rounded-b-md bg-white p-4 relative">
                {directors.length > 1 && (
                  <button type="button" onClick={() => { setDirectors(directors.filter((_, idx) => idx !== di)); setActiveDirectorTab(Math.max(0, di - 1)); }}
                    className="absolute top-3 right-3 text-slate-400 hover:text-red-500" title="Delete this director">
                    <Trash2 size={15} />
                  </button>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Name"><input className={inputClass} value={d.name} onChange={e => updateDirector(di, { name: e.target.value })} /></Field>
                  <Field label="ID Type">
                    <select className={inputClass} value={d.identificationType} onChange={e => updateDirector(di, { identificationType: e.target.value })}>
                      <option value="">—</option>
                      {ID_TYPES_DIRECTOR.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Identification Number"><input className={inputClass} value={d.identificationNumber} onChange={e => updateDirector(di, { identificationNumber: e.target.value })} /></Field>
                  <Field label="Nationality"><input className={inputClass} value={d.nationality} onChange={e => updateDirector(di, { nationality: e.target.value })} /></Field>
                  <DateField label="Date of birth" value={d.dateOfBirth} onChange={v => updateDirector(di, { dateOfBirth: v })} />
                  <Field label="Gender">
                    <select className={inputClass} value={d.gender} onChange={e => updateDirector(di, { gender: e.target.value })}>
                      <option value="">—</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </Field>
                  <Field label="Email Address"><input className={inputClass} value={d.email} onChange={e => updateDirector(di, { email: e.target.value })} /></Field>
                  <Field label="Contact Number"><input className={inputClass} value={d.phone} onChange={e => updateDirector(di, { phone: e.target.value })} /></Field>
                </div>
                <div className="mt-4">
                  <Field label="Address"><textarea rows={2} className={`${inputClass} resize-none`} value={d.address} onChange={e => updateDirector(di, { address: e.target.value })} /></Field>
                </div>
                <div className="mt-4 max-w-xs">
                  <YesNoField label="是否为名义董事" value={d.isNomineeDirector} onChange={v => updateDirector(di, { isNomineeDirector: v, nominatorType: v ? (d.nominatorType || 'individual') : '' })} />
                </div>

                {d.isNomineeDirector && isTassureNd && (
                  <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 p-3">
                    <div className="text-sm font-medium text-slate-600 mb-2">Nominee Director details</div>
                    <Field label="Nominator Type">
                      <select className={inputClass} value={d.nominatorType} onChange={e => updateDirector(di, { nominatorType: e.target.value as PostIncorporateDirector['nominatorType'] })}>
                        <option value="individual">Individual</option>
                        <option value="corporate entity">Corporate Entity</option>
                      </select>
                    </Field>
                    {d.nominatorType === 'individual' ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                        <div className="col-span-2 md:col-span-4">
                          <Field label="Quick-fill Nominator from an existing Director/Shareholder (optional)">
                            <select className={inputClass} value="" onChange={e => {
                              const cand = nominatorCandidatesFrom(directors, shareholders, { kind: 'director', index: di }).find(c => c.key === e.target.value);
                              if (cand) updateDirector(di, nominatorFillFrom(cand));
                            }}>
                              <option value="">— 手动填写 Manual entry —</option>
                              {nominatorCandidatesFrom(directors, shareholders, { kind: 'director', index: di }).map(c => (
                                <option key={c.key} value={c.key}>{c.label}</option>
                              ))}
                            </select>
                          </Field>
                        </div>
                        <Field label="Nominator Name"><input className={inputClass} value={d.nominatorIndName || ''} onChange={e => updateDirector(di, { nominatorIndName: e.target.value })} /></Field>
                        <Field label="Nominator Address"><input className={inputClass} value={d.nominatorIndAddress || ''} onChange={e => updateDirector(di, { nominatorIndAddress: e.target.value })} /></Field>
                        <Field label="Nominator Nationality"><input className={inputClass} value={d.nominatorIndNationality || ''} onChange={e => updateDirector(di, { nominatorIndNationality: e.target.value })} /></Field>
                        <Field label="Nominator ID Number"><input className={inputClass} value={d.nominatorIndIdentificationNumber || ''} onChange={e => updateDirector(di, { nominatorIndIdentificationNumber: e.target.value })} /></Field>
                        <DateField label="Nominator Birth Date" value={d.nominatorIndBirthDate || ''} onChange={v => updateDirector(di, { nominatorIndBirthDate: v })} />
                        <Field label="Nominator Email"><input className={inputClass} value={d.nominatorIndEmail || ''} onChange={e => updateDirector(di, { nominatorIndEmail: e.target.value })} /></Field>
                        <Field label="Nominator Contact No."><input className={inputClass} value={d.nominatorIndContactNumber || ''} onChange={e => updateDirector(di, { nominatorIndContactNumber: e.target.value })} /></Field>
                        <DateField label="Date Became Nominator" value={d.nominatorIndDateBecameNominator || ''} onChange={v => updateDirector(di, { nominatorIndDateBecameNominator: v })} />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                        <Field label="Nominator Corp Name"><input className={inputClass} value={d.nominatorCorpName || ''} onChange={e => updateDirector(di, { nominatorCorpName: e.target.value })} /></Field>
                        <Field label="Nominator Corp UEN"><input className={inputClass} value={d.nominatorCorpUen || ''} onChange={e => updateDirector(di, { nominatorCorpUen: e.target.value })} /></Field>
                        <Field label="Registered Address"><input className={inputClass} value={d.nominatorCorpRegisteredAddress || ''} onChange={e => updateDirector(di, { nominatorCorpRegisteredAddress: e.target.value })} /></Field>
                        <Field label="Legal Form"><input className={inputClass} value={d.nominatorCorpLegalForm || ''} onChange={e => updateDirector(di, { nominatorCorpLegalForm: e.target.value })} /></Field>
                        <Field label="Corp Representative"><input className={inputClass} value={d.nominatorCorpRepresentative || ''} onChange={e => updateDirector(di, { nominatorCorpRepresentative: e.target.value })} /></Field>
                        <Field label="Corp Email"><input className={inputClass} value={d.nominatorCorpEmail || ''} onChange={e => updateDirector(di, { nominatorCorpEmail: e.target.value })} /></Field>
                        <Field label="Corp Contact No."><input className={inputClass} value={d.nominatorCorpContactNumber || ''} onChange={e => updateDirector(di, { nominatorCorpContactNumber: e.target.value })} /></Field>
                        <DateField label="Date Became Nominator" value={d.nominatorCorpDateBecameNominator || ''} onChange={v => updateDirector(di, { nominatorCorpDateBecameNominator: v })} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          );
        })()}
      </section>

      {/* Secretary */}
      <section className={cardClass}>
        <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
          <div className={`${sectionTitleClass} mb-0`}>秘书 Secretary{parsedSuffix}</div>
          <button type="button" onClick={() => { setSecretaries([...secretaries, emptySecretary()]); setActiveSecretaryTab(secretaries.length); }}
            className={addRowButtonClass}>
            <Plus size={15} /> 新增一行 Add Row
          </button>
        </div>
        <div className="flex items-center gap-2 text-sm mb-3">
          <span className="font-medium text-slate-600">秘书姓名 Secretary Name</span>
          <select className={inputClass} value={company.secretaryName} onChange={e => setCompany({ ...company, secretaryName: e.target.value })}>
            <option value="">—</option>
            {secretaries.filter(s => s.name.trim()).map((s, idx) => <option key={idx} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        {(() => {
          const si = Math.min(activeSecretaryTab, secretaries.length - 1);
          const s = secretaries[si];
          return (
            <>
              <div className="flex gap-1 overflow-x-auto">
                {secretaries.map((ss, i) => (
                  <button key={i} type="button" className={tabClass(i === si)} onClick={() => setActiveSecretaryTab(i)}>
                    {ss.name.trim() || `Secretary ${i + 1}`}
                  </button>
                ))}
              </div>
              <div className="border border-slate-300 border-t-0 rounded-b-md bg-white p-4 relative">
                {secretaries.length > 1 && (
                  <button type="button" onClick={() => {
                    const removedName = s.name;
                    setSecretaries(secretaries.filter((_, idx) => idx !== si));
                    setCompany(c => (c.secretaryName === removedName ? { ...c, secretaryName: '' } : c));
                    setActiveSecretaryTab(Math.max(0, si - 1));
                  }} className="absolute top-3 right-3 text-slate-400 hover:text-red-500" title="Delete this secretary">
                    <Trash2 size={15} />
                  </button>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Name">
                    <input className={inputClass} value={s.name} onChange={e => {
                      const prevName = s.name;
                      updateSecretary(si, { name: e.target.value });
                      setCompany(c => (c.secretaryName === prevName || !c.secretaryName ? { ...c, secretaryName: e.target.value } : c));
                    }} />
                  </Field>
                  <Field label="ID Type">
                    <select className={inputClass} value={s.identificationType} onChange={e => updateSecretary(si, { identificationType: e.target.value })}>
                      <option value="">—</option>
                      {ID_TYPES_DIRECTOR.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Identification Number"><input className={inputClass} value={s.identificationNumber} onChange={e => updateSecretary(si, { identificationNumber: e.target.value })} /></Field>
                  <Field label="Nationality"><input className={inputClass} value={s.nationality} onChange={e => updateSecretary(si, { nationality: e.target.value })} /></Field>
                  <DateField label="Date of Appointment" value={s.dateOfAppointment} onChange={v => updateSecretary(si, { dateOfAppointment: v })} />
                  <DateField label="Date of birth" value={s.dateOfBirth} onChange={v => updateSecretary(si, { dateOfBirth: v })} />
                  <Field label="Email Address"><input className={inputClass} value={s.email} onChange={e => updateSecretary(si, { email: e.target.value })} /></Field>
                  <Field label="Contact Number"><input className={inputClass} value={s.phone} onChange={e => updateSecretary(si, { phone: e.target.value })} /></Field>
                </div>
                <div className="mt-4">
                  <Field label="Address"><textarea rows={2} className={`${inputClass} resize-none`} value={s.address} onChange={e => updateSecretary(si, { address: e.target.value })} /></Field>
                </div>
              </div>
            </>
          );
        })()}
      </section>

      {/* Shareholders */}
      <section className={cardClass}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div className={`${sectionTitleClass} mb-0`}>股东 Shareholders{parsedSuffix}</div>
          <button type="button" onClick={() => { setShareholders([...shareholders, emptyShareholder()]); setActiveShareholderTab(shareholders.length); }}
            className={addRowButtonClass}>
            <Plus size={15} /> 新增一行 Add Row
          </button>
        </div>
        {(() => {
          const si = Math.min(activeShareholderTab, shareholders.length - 1);
          const s = shareholders[si];
          const isCorp = s.identificationType.trim().toUpperCase() === 'UEN';
          return (
            <>
              <div className="flex gap-1 overflow-x-auto">
                {shareholders.map((ss, i) => (
                  <button key={i} type="button" className={tabClass(i === si)} onClick={() => setActiveShareholderTab(i)}>
                    {ss.name.trim() || `Shareholder ${i + 1}`}
                  </button>
                ))}
              </div>
              <div className="border border-slate-300 border-t-0 rounded-b-md bg-white p-4 relative">
                {shareholders.length > 1 && (
                  <button type="button" onClick={() => { setShareholders(shareholders.filter((_, idx) => idx !== si)); setActiveShareholderTab(Math.max(0, si - 1)); }}
                    className="absolute top-3 right-3 text-slate-400 hover:text-red-500" title="Delete this shareholder">
                    <Trash2 size={15} />
                  </button>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Name"><input className={inputClass} value={s.name} onChange={e => updateShareholder(si, { name: e.target.value })} /></Field>
                  <Field label="ID Type">
                    <select className={inputClass} value={s.identificationType} onChange={e => updateShareholder(si, { identificationType: e.target.value })}>
                      <option value="">—</option>
                      {ID_TYPES_SHAREHOLDER.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Identification Number"><input className={inputClass} value={s.identificationNumber} onChange={e => updateShareholder(si, { identificationNumber: e.target.value })} /></Field>
                  <Field label="Nationality"><input className={inputClass} value={s.nationality} onChange={e => updateShareholder(si, { nationality: e.target.value })} /></Field>
                  <Field label="Number of Shares"><input className={inputClass} value={s.numberOfShares} onChange={e => updateShareholder(si, { numberOfShares: e.target.value })} /></Field>
                  <Field label="Paid-Up Capital">
                    <div className="flex items-center gap-2">
                      <input className={inputClass} value={s.paidUpCapital} onChange={e => updateShareholder(si, { paidUpCapital: e.target.value })} />
                      <input className={`${inputClass} w-40 shrink-0`} value={s.currency} placeholder="SINGAPORE DOLLAR"
                        onChange={e => updateShareholder(si, { currency: e.target.value })} />
                    </div>
                  </Field>
                  <YesNoField label="是否fully paid-up" value={s.fullyPaidUp} onChange={v => updateShareholder(si, { fullyPaidUp: v })} />
                  <Field label="Share Certificate No."><input className={inputClass} value={s.shareCertificateNo || ''} onChange={e => updateShareholder(si, { shareCertificateNo: e.target.value })} /></Field>
                  <YesNoField label="是否为Registrable Controller" value={s.isRorc} onChange={v => updateShareholder(si, { isRorc: v })} />
                  <DateField label="Date of birth" value={s.dateOfBirth} onChange={v => updateShareholder(si, { dateOfBirth: v })} />
                  <Field label="Email Address"><input className={inputClass} value={s.email} onChange={e => updateShareholder(si, { email: e.target.value })} /></Field>
                  <Field label="Contact Number"><input className={inputClass} value={s.phone} onChange={e => updateShareholder(si, { phone: e.target.value })} /></Field>
                </div>
                <div className="mt-4">
                  <Field label="Address"><textarea rows={2} className={`${inputClass} resize-none`} value={s.address} onChange={e => updateShareholder(si, { address: e.target.value })} /></Field>
                </div>
                <div className="mt-4 max-w-xs">
                  <YesNoField label="是否为名义股东" value={!!s.isNomineeShareholder} onChange={v => updateShareholder(si, { isNomineeShareholder: v, nominatorType: v ? (s.nominatorType || 'individual') : '' })} />
                </div>

                {isCorp && (
                  <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 p-3">
                    <div className="text-sm font-medium text-slate-600 mb-2">Corporate Shareholder Details</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <Field label="Corp Representative"><input className={inputClass} value={s.corpRepresentative || ''} onChange={e => updateShareholder(si, { corpRepresentative: e.target.value })} /></Field>
                      <Field label="Corp Rep ID Type"><input className={inputClass} value={s.corpRepIdType || ''} onChange={e => updateShareholder(si, { corpRepIdType: e.target.value })} /></Field>
                      <Field label="Corp Rep ID No."><input className={inputClass} value={s.corpRepIdNo || ''} onChange={e => updateShareholder(si, { corpRepIdNo: e.target.value })} /></Field>
                    </div>
                    <div className="mt-3">
                      <Field label="Corporate Director Names (one per line — at least one required)">
                        <textarea className={`${inputClass} min-h-[70px]`} value={(s.corporateDirectorNames || []).join('\n')}
                          onChange={e => updateShareholder(si, { corporateDirectorNames: e.target.value.split('\n') })} />
                      </Field>
                    </div>
                  </div>
                )}

                {s.isNomineeShareholder && (
                  <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 p-3">
                    <div className="text-sm font-medium text-slate-600 mb-2">Nominee Shareholder details</div>
                    <Field label="Nominator Type">
                      <select className={inputClass} value={s.nominatorType} onChange={e => updateShareholder(si, { nominatorType: e.target.value as PostIncorporateShareholder['nominatorType'] })}>
                        <option value="individual">Individual</option>
                        <option value="corporate entity">Corporate Entity</option>
                      </select>
                    </Field>
                    {s.nominatorType === 'individual' ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                        <div className="col-span-2 md:col-span-4">
                          <Field label="Quick-fill Nominator from an existing Director/Shareholder (optional)">
                            <select className={inputClass} value="" onChange={e => {
                              const cand = nominatorCandidatesFrom(directors, shareholders, { kind: 'shareholder', index: si }).find(c => c.key === e.target.value);
                              if (cand) updateShareholder(si, nominatorFillFrom(cand));
                            }}>
                              <option value="">— 手动填写 Manual entry —</option>
                              {nominatorCandidatesFrom(directors, shareholders, { kind: 'shareholder', index: si }).map(c => (
                                <option key={c.key} value={c.key}>{c.label}</option>
                              ))}
                            </select>
                          </Field>
                        </div>
                        <Field label="Nominator Name"><input className={inputClass} value={s.nominatorIndName || ''} onChange={e => updateShareholder(si, { nominatorIndName: e.target.value })} /></Field>
                        <Field label="Nominator Address"><input className={inputClass} value={s.nominatorIndAddress || ''} onChange={e => updateShareholder(si, { nominatorIndAddress: e.target.value })} /></Field>
                        <Field label="Nominator Nationality"><input className={inputClass} value={s.nominatorIndNationality || ''} onChange={e => updateShareholder(si, { nominatorIndNationality: e.target.value })} /></Field>
                        <Field label="Nominator ID Number"><input className={inputClass} value={s.nominatorIndIdentificationNumber || ''} onChange={e => updateShareholder(si, { nominatorIndIdentificationNumber: e.target.value })} /></Field>
                        <DateField label="Nominator Birth Date" value={s.nominatorIndBirthDate || ''} onChange={v => updateShareholder(si, { nominatorIndBirthDate: v })} />
                        <Field label="Nominator Email"><input className={inputClass} value={s.nominatorIndEmail || ''} onChange={e => updateShareholder(si, { nominatorIndEmail: e.target.value })} /></Field>
                        <Field label="Nominator Contact No."><input className={inputClass} value={s.nominatorIndContactNumber || ''} onChange={e => updateShareholder(si, { nominatorIndContactNumber: e.target.value })} /></Field>
                        <DateField label="Date Became Nominator" value={s.nominatorIndDateBecameNominator || ''} onChange={v => updateShareholder(si, { nominatorIndDateBecameNominator: v })} />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                        <Field label="Nominator Corp Name"><input className={inputClass} value={s.nominatorCorpName || ''} onChange={e => updateShareholder(si, { nominatorCorpName: e.target.value })} /></Field>
                        <Field label="Nominator Corp UEN"><input className={inputClass} value={s.nominatorCorpUen || ''} onChange={e => updateShareholder(si, { nominatorCorpUen: e.target.value })} /></Field>
                        <Field label="Registered Address"><input className={inputClass} value={s.nominatorCorpRegisteredAddress || ''} onChange={e => updateShareholder(si, { nominatorCorpRegisteredAddress: e.target.value })} /></Field>
                        <Field label="Legal Form"><input className={inputClass} value={s.nominatorCorpLegalForm || ''} onChange={e => updateShareholder(si, { nominatorCorpLegalForm: e.target.value })} /></Field>
                        <Field label="Corp Representative"><input className={inputClass} value={s.nominatorCorpRepresentative || ''} onChange={e => updateShareholder(si, { nominatorCorpRepresentative: e.target.value })} /></Field>
                        <Field label="Corp Email"><input className={inputClass} value={s.nominatorCorpEmail || ''} onChange={e => updateShareholder(si, { nominatorCorpEmail: e.target.value })} /></Field>
                        <Field label="Corp Contact No."><input className={inputClass} value={s.nominatorCorpContactNumber || ''} onChange={e => updateShareholder(si, { nominatorCorpContactNumber: e.target.value })} /></Field>
                        <DateField label="Date Became Nominator" value={s.nominatorCorpDateBecameNominator || ''} onChange={v => updateShareholder(si, { nominatorCorpDateBecameNominator: v })} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          );
        })()}
      </section>

      {errors.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <div className="font-semibold mb-1">Please fix the following:</div>
          <ul className="list-disc pl-5 flex flex-col gap-0.5">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">{success}</div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={handleSubmit} disabled={submitting}
          className="flex items-center gap-2 rounded-lg bg-[#1d395e] hover:bg-[#16293f] disabled:opacity-60 text-white font-medium px-5 py-2.5 text-sm">
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {submitting ? 'Generating…' : 'Generate Documents (ZIP)'}
        </button>
      </div>
    </div>

    {missingFromBizfile && (missingFromBizfile.directors.length > 0 || missingFromBizfile.secretaries.length > 0 || missingFromBizfile.shareholderNames.length > 0) && (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5 max-h-[85vh] overflow-y-auto">
          <div className="text-base font-semibold text-slate-800 mb-1">TeamWork 检测到额外人员 Structure mismatch</div>
          <p className="text-sm text-slate-500 mb-4">
            TeamWork 的记录里，以下人员在对应角色里存在，但这次 Bizfile 解析结果里没有检测到。要加进来吗？
          </p>
          <div className="flex flex-col gap-4">
            {missingFromBizfile.directors.length > 0 && (
              <div>
                <div className="text-sm font-medium text-slate-600 mb-2">Directors 董事</div>
                <div className="flex flex-col gap-2">
                  {missingFromBizfile.directors.map((o, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-2.5">
                      <div className="text-sm">
                        <div className="font-medium text-slate-800">{o.name}</div>
                        <div className="text-xs text-slate-500">{o.subRoles || 'Director'}</div>
                      </div>
                      <button type="button" onClick={() => addMissingDirector(o)}
                        className="flex items-center gap-1 rounded-md border border-slate-400 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium px-2.5 py-1.5">
                        <Plus size={13} /> Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {missingFromBizfile.secretaries.length > 0 && (
              <div>
                <div className="text-sm font-medium text-slate-600 mb-2">Secretaries 秘书</div>
                <div className="flex flex-col gap-2">
                  {missingFromBizfile.secretaries.map((o, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-2.5">
                      <div className="text-sm font-medium text-slate-800">{o.name}</div>
                      <button type="button" onClick={() => addMissingSecretary(o)}
                        className="flex items-center gap-1 rounded-md border border-slate-400 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium px-2.5 py-1.5">
                        <Plus size={13} /> Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {missingFromBizfile.shareholderNames.length > 0 && (
              <div>
                <div className="text-sm font-medium text-slate-600 mb-2">Shareholders 股东（来自TW真实股权登记册）</div>
                <div className="flex flex-col gap-2">
                  {missingFromBizfile.shareholderNames.map((name, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 p-2.5">
                      <div className="text-sm font-medium text-slate-800">{name}</div>
                      <button type="button" onClick={() => addMissingShareholder(name)}
                        className="flex items-center gap-1 rounded-md border border-slate-400 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-medium px-2.5 py-1.5">
                        <Plus size={13} /> Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end mt-5">
            <button type="button" onClick={() => setMissingFromBizfile(null)}
              className="rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-4 py-2">
              Dismiss (不添加)
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
