'use client';

import { useState } from 'react';
import { Plus, Trash2, Loader2, FileSignature, Download } from 'lucide-react';
import type { PostIncorporateCompany, PostIncorporateDirector, PostIncorporateShareholder } from '@/lib/docx-post-incorporate';

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
type ShareholderRow = PostIncorporateShareholder & { dateOfAppointment: string; phone: string; email: string; isRorc: boolean; nationality: string; dateOfBirth: string };
type SecretaryRow = { name: string; address: string; identificationType: string; identificationNumber: string; nationality: string; dateOfAppointment: string; dateOfBirth: string; email: string; phone: string };
// TeamWork's own per-person detail (see lib/teamwork-company-profile.ts's
// OfficerDetail) — used both to enrich matched people and to offer adding
// people TeamWork knows about that Bizfile's own result didn't include.
type TeamworkOfficial = { name: string; role: string; dob: string; email: string; mobile: string; telephone: string; subRoles: string };

// Tassure's own registered name — the corporate secretarial firm on every
// Post Incorporate document regardless of client, confirmed against the
// reference desktop app's own output for a real company (its Secretarial
// Firm Address there matched the named Secretary's own parsed Bizfile
// address exactly, since Tassure's appointed secretary staff are based out
// of Tassure's own office — so the address auto-fills from the parsed
// Secretary below rather than being a second hardcoded constant).
const SECRETARY_COMPANY_NAME = 'TASSURE ASIA BIZSERVICES PTE LTD';

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
    dateOfAppointment: '', phone: '', email: '', isRorc: false, nationality: '', dateOfBirth: '',
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
      const bfShareholders = (body.shareholders || []) as { name: string; address: string; identificationType: string; identificationNumber: string; nationality: string; numberOfShares: string }[];

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
      try {
        const enrichRes = await fetch(`/api/post-incorporate/enrich?uen=${encodeURIComponent(body.company.uen || '')}&company=${encodeURIComponent(body.company.name || '')}`);
        if (enrichRes.ok) {
          const enrichBody = await enrichRes.json();
          enrichedFye = enrichBody.financialYearEndDayMonth || '';
          nomineeDirectorNames = enrichBody.nomineeDirectorNames || [];
          teamworkOfficials = enrichBody.teamworkOfficials || [];
          teamworkShareholderNames = enrichBody.teamworkShareholderNames || [];
        }
      } catch { /* enrichment is a nice-to-have; a failure here shouldn't block the Bizfile result itself */ }
      const officialByName = new Map(teamworkOfficials.map(o => [o.name.trim().toUpperCase(), o]));

      if (body.secretary) {
        const match = officialByName.get((body.secretary.name || '').trim().toUpperCase());
        setSecretaries([{
          name: body.secretary.name || '', address: body.secretary.address || '',
          identificationType: body.secretary.identificationType || 'NRIC',
          identificationNumber: body.secretary.identificationNumber || '',
          nationality: body.secretary.nationality || '', dateOfAppointment: body.secretary.dateOfAppointment || '',
          dateOfBirth: match?.dob || '', email: match?.email || '', phone: match?.mobile || '',
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
            dateOfBirth: match?.dob || '', email: match?.email || '', phone: match?.mobile || '',
            // The nominator's own details (who engaged Tassure to provide
            // this ND) aren't tracked anywhere by either source, so only the
            // flag itself is auto-set; those sub-fields stay manual.
            isNomineeDirector: isNominee, nominatorType: isNominee ? 'individual' : '',
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
          return {
            ...emptyShareholder(), name: s.name, address: s.address, identificationType: s.identificationType || 'NRIC',
            identificationNumber: s.identificationNumber, nationality: s.nationality || '', numberOfShares: s.numberOfShares,
            dateOfBirth: match?.dob || '', email: match?.email || '', phone: match?.mobile || '',
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
    setDirectors(current => [...current, { ...emptyDirector(), name: o.name, dateOfBirth: o.dob, email: o.email, phone: o.mobile }]);
    setActiveDirectorTab(directors.length);
    setMissingFromBizfile(current => current && { ...current, directors: current.directors.filter(d => d !== o) });
  }
  function addMissingSecretary(o: TeamworkOfficial) {
    setSecretaries(current => [...current, { ...emptySecretary(), name: o.name, dateOfBirth: o.dob, email: o.email, phone: o.mobile }]);
    setActiveSecretaryTab(secretaries.length);
    setMissingFromBizfile(current => current && { ...current, secretaries: current.secretaries.filter(s => s !== o) });
  }
  function addMissingShareholder(name: string) {
    setShareholders(current => [...current, { ...emptyShareholder(), name }]);
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
    <div className="p-6 max-w-[1500px] mx-auto flex flex-col gap-7">
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
        <label className="flex items-center gap-2 rounded-md bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium px-4 py-2 w-fit cursor-pointer">
          {bizfileLoading ? <Loader2 size={14} className="animate-spin" /> : <FileSignature size={14} />}
          {bizfileLoading ? 'Parsing…' : 'Upload Bizfile PDF'}
          <input type="file" accept="application/pdf" className="hidden" disabled={bizfileLoading}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleBizfileUpload(f); e.target.value = ''; }} />
        </label>
        {bizfileMessage && <p className="text-sm text-slate-500 mt-2">{bizfileMessage}</p>}
      </section>

      {/* Company */}
      <section className={cardClass}>
        <div className={sectionTitleClass}>Company Information 公司信息</div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Company Name 企业名称"><input className={inputClass} value={company.name} onChange={e => setCompany({ ...company, name: e.target.value })} /></Field>
          <Field label="Company UEN 公司注册编号"><input className={inputClass} value={company.uen} onChange={e => setCompany({ ...company, uen: e.target.value })} /></Field>
          <Field label="Incorporation Date 成立日期"><input type="date" className={inputClass} value={company.regDate} onChange={e => setCompany({ ...company, regDate: e.target.value })} /></Field>
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
                  <Field label="Date of birth"><input type="date" className={inputClass} value={d.dateOfBirth} onChange={e => updateDirector(di, { dateOfBirth: e.target.value })} /></Field>
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

                {d.isNomineeDirector && (
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
                        <Field label="Nominator Name"><input className={inputClass} value={d.nominatorIndName || ''} onChange={e => updateDirector(di, { nominatorIndName: e.target.value })} /></Field>
                        <Field label="Nominator Address"><input className={inputClass} value={d.nominatorIndAddress || ''} onChange={e => updateDirector(di, { nominatorIndAddress: e.target.value })} /></Field>
                        <Field label="Nominator Nationality"><input className={inputClass} value={d.nominatorIndNationality || ''} onChange={e => updateDirector(di, { nominatorIndNationality: e.target.value })} /></Field>
                        <Field label="Nominator ID Number"><input className={inputClass} value={d.nominatorIndIdentificationNumber || ''} onChange={e => updateDirector(di, { nominatorIndIdentificationNumber: e.target.value })} /></Field>
                        <Field label="Nominator Birth Date"><input type="date" className={inputClass} value={d.nominatorIndBirthDate || ''} onChange={e => updateDirector(di, { nominatorIndBirthDate: e.target.value })} /></Field>
                        <Field label="Nominator Email"><input className={inputClass} value={d.nominatorIndEmail || ''} onChange={e => updateDirector(di, { nominatorIndEmail: e.target.value })} /></Field>
                        <Field label="Nominator Contact No."><input className={inputClass} value={d.nominatorIndContactNumber || ''} onChange={e => updateDirector(di, { nominatorIndContactNumber: e.target.value })} /></Field>
                        <Field label="Date Became Nominator"><input type="date" className={inputClass} value={d.nominatorIndDateBecameNominator || ''} onChange={e => updateDirector(di, { nominatorIndDateBecameNominator: e.target.value })} /></Field>
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
                        <Field label="Date Became Nominator"><input type="date" className={inputClass} value={d.nominatorCorpDateBecameNominator || ''} onChange={e => updateDirector(di, { nominatorCorpDateBecameNominator: e.target.value })} /></Field>
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
                  <Field label="Date of Appointment"><input type="date" className={inputClass} value={s.dateOfAppointment} onChange={e => updateSecretary(si, { dateOfAppointment: e.target.value })} /></Field>
                  <Field label="Date of birth"><input type="date" className={inputClass} value={s.dateOfBirth} onChange={e => updateSecretary(si, { dateOfBirth: e.target.value })} /></Field>
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
                      <span className="text-xs text-slate-500 whitespace-nowrap">SINGAPORE DOLLAR</span>
                    </div>
                  </Field>
                  <YesNoField label="是否fully paid-up" value={s.fullyPaidUp} onChange={v => updateShareholder(si, { fullyPaidUp: v })} />
                  <Field label="Share Certificate No."><input className={inputClass} value={s.shareCertificateNo || ''} onChange={e => updateShareholder(si, { shareCertificateNo: e.target.value })} /></Field>
                  <YesNoField label="是否为Registrable Controller" value={s.isRorc} onChange={v => updateShareholder(si, { isRorc: v })} />
                  <Field label="Date of birth"><input type="date" className={inputClass} value={s.dateOfBirth} onChange={e => updateShareholder(si, { dateOfBirth: e.target.value })} /></Field>
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
                        <Field label="Nominator Name"><input className={inputClass} value={s.nominatorIndName || ''} onChange={e => updateShareholder(si, { nominatorIndName: e.target.value })} /></Field>
                        <Field label="Nominator Address"><input className={inputClass} value={s.nominatorIndAddress || ''} onChange={e => updateShareholder(si, { nominatorIndAddress: e.target.value })} /></Field>
                        <Field label="Nominator Nationality"><input className={inputClass} value={s.nominatorIndNationality || ''} onChange={e => updateShareholder(si, { nominatorIndNationality: e.target.value })} /></Field>
                        <Field label="Nominator ID Number"><input className={inputClass} value={s.nominatorIndIdentificationNumber || ''} onChange={e => updateShareholder(si, { nominatorIndIdentificationNumber: e.target.value })} /></Field>
                        <Field label="Nominator Birth Date"><input type="date" className={inputClass} value={s.nominatorIndBirthDate || ''} onChange={e => updateShareholder(si, { nominatorIndBirthDate: e.target.value })} /></Field>
                        <Field label="Nominator Email"><input className={inputClass} value={s.nominatorIndEmail || ''} onChange={e => updateShareholder(si, { nominatorIndEmail: e.target.value })} /></Field>
                        <Field label="Nominator Contact No."><input className={inputClass} value={s.nominatorIndContactNumber || ''} onChange={e => updateShareholder(si, { nominatorIndContactNumber: e.target.value })} /></Field>
                        <Field label="Date Became Nominator"><input type="date" className={inputClass} value={s.nominatorIndDateBecameNominator || ''} onChange={e => updateShareholder(si, { nominatorIndDateBecameNominator: e.target.value })} /></Field>
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
                        <Field label="Date Became Nominator"><input type="date" className={inputClass} value={s.nominatorCorpDateBecameNominator || ''} onChange={e => updateShareholder(si, { nominatorCorpDateBecameNominator: e.target.value })} /></Field>
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
