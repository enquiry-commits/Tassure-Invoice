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
type SecretaryRow = { name: string; address: string; identificationType: string; identificationNumber: string; nationality: string; dateOfAppointment: string };

function emptyCompany(): PostIncorporateCompany {
  return {
    name: '', uen: '', address: '', regDate: '', chairmanName: '', secretaryName: '',
    secretaryCompanyName: '', secretaryCompanyAddress: '', currency: 'SGD',
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
  return { name: '', address: '', identificationType: 'NRIC', identificationNumber: '', nationality: '', dateOfAppointment: '' };
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
      <span className="font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const inputClass = 'rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';
const cellInputClass = 'w-full min-w-[110px] rounded border border-slate-300 px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/40 focus:border-blue-400';
const thClass = 'border border-slate-200 bg-slate-50 px-2 py-1.5 text-left font-medium text-slate-600 whitespace-nowrap';
const tdClass = 'border border-slate-200 px-1 py-1 align-top';
const cardClass = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';
const sectionTitleClass = 'text-base font-semibold text-slate-800 mb-4';
const tabClass = (active: boolean) => `px-3 py-1.5 text-sm font-medium border-b-2 ${active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`;

export default function PostIncorporatePage() {
  const [company, setCompany] = useState<PostIncorporateCompany>(emptyCompany());
  const [companyExtra, setCompanyExtra] = useState<CompanyExtra>(emptyCompanyExtra());
  const [capitalTab, setCapitalTab] = useState<'issued' | 'paidUp'>('issued');
  const [directors, setDirectors] = useState<DirectorRow[]>([emptyDirector()]);
  const [secretaries, setSecretaries] = useState<SecretaryRow[]>([emptySecretary()]);
  const [shareholders, setShareholders] = useState<ShareholderRow[]>([emptyShareholder()]);
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
      if (body.secretary) {
        setSecretaries([{
          name: body.secretary.name || '', address: body.secretary.address || '',
          identificationType: body.secretary.identificationType || 'NRIC',
          identificationNumber: body.secretary.identificationNumber || '',
          nationality: body.secretary.nationality || '', dateOfAppointment: body.secretary.dateOfAppointment || '',
        }]);
      }

      const bfDirectors = (body.directors || []) as { name: string; address: string; identificationType: string; identificationNumber: string; nationality: string; dateOfAppointment: string }[];
      const bfShareholders = (body.shareholders || []) as { name: string; address: string; identificationType: string; identificationNumber: string; nationality: string; numberOfShares: string }[];
      if (bfDirectors.length) {
        setDirectors(bfDirectors.map(d => ({ ...emptyDirector(), name: d.name, address: d.address, identificationType: d.identificationType || 'NRIC', identificationNumber: d.identificationNumber, nationality: d.nationality, dateOfAppointment: d.dateOfAppointment || '' })));
      }
      if (bfShareholders.length) {
        setShareholders(bfShareholders.map(s => ({ ...emptyShareholder(), name: s.name, address: s.address, identificationType: s.identificationType || 'NRIC', identificationNumber: s.identificationNumber, nationality: s.nationality || '', numberOfShares: s.numberOfShares })));
      }
      setBizfileParsed(true);
      setBizfileMessage(`Parsed from Bizfile: company info, ${bfDirectors.length} director(s), ${bfShareholders.length} shareholder(s) pre-filled. This is the official ACRA extract — still verify before generating (e.g. nominee status, paid-up amounts, and date of birth aren't on the Bizfile and need to be filled in manually).`);
    } catch (error) {
      setBizfileMessage(error instanceof Error ? error.message : 'Unexpected error parsing the PDF.');
    } finally {
      setBizfileLoading(false);
    }
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
    <div className="p-6 max-w-6xl mx-auto flex flex-col gap-6">
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
          <div className="flex gap-1 border-b border-slate-200 mb-3">
            <button type="button" className={tabClass(capitalTab === 'issued')} onClick={() => setCapitalTab('issued')}>Issued Share Capital</button>
            <button type="button" className={tabClass(capitalTab === 'paidUp')} onClick={() => setCapitalTab('paidUp')}>Paid-Up Capital</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 rounded-md bg-slate-50 border border-slate-200 p-3">
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

        {/* Fields the templates actually consume but aren't part of ACRA's
            own Company Information page — kept visually separated below. */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4 pt-4 border-t border-slate-100">
          <Field label="Secretarial Firm Name"><input className={inputClass} value={company.secretaryCompanyName} onChange={e => setCompany({ ...company, secretaryCompanyName: e.target.value })} /></Field>
          <Field label="Secretarial Firm Address"><input className={inputClass} value={company.secretaryCompanyAddress} onChange={e => setCompany({ ...company, secretaryCompanyAddress: e.target.value })} /></Field>
          <Field label="Currency (for documents)"><input className={inputClass} value={company.currency} onChange={e => setCompany({ ...company, currency: e.target.value })} /></Field>
          <Field label="Financial Year End (e.g. 31 December)"><input className={inputClass} value={company.financialYearEndDayMonth} onChange={e => setCompany({ ...company, financialYearEndDayMonth: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm mt-4">
          <input type="checkbox" checked={company.needNdService} onChange={e => setCompany({ ...company, needNdService: e.target.checked })} />
          <span>Company needs Nominee Director (ND) service — generates the ND Agreement</span>
        </label>
      </section>

      {/* Directors */}
      <section className={cardClass}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className={`${sectionTitleClass} mb-0`}>DIRECTOR 董事{parsedSuffix}</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-slate-600">Chairman 主席</span>
              <select className={inputClass} value={company.chairmanName} onChange={e => setCompany({ ...company, chairmanName: e.target.value })}>
                <option value="">—</option>
                {directors.filter(d => d.name.trim()).map((d, idx) => <option key={idx} value={d.name}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <button type="button" onClick={() => setDirectors([...directors, emptyDirector()])}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
            <Plus size={15} /> 新增一行 Add Row
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={`${thClass} w-7`}></th>
                <th className={`${thClass} w-9`}>No.</th>
                <th className={thClass}>Name</th>
                <th className={thClass}>Birth Date</th>
                <th className={thClass}>Contact No</th>
                <th className={thClass}>Email Address</th>
                <th className={thClass}>ID Type</th>
                <th className={thClass}>Identification Number</th>
                <th className={thClass}>Nationality/Place of Origin</th>
                <th className={thClass}>Address</th>
                <th className={thClass}>Date of Appointment</th>
                <th className={thClass}>Nominee</th>
              </tr>
            </thead>
            <tbody>
              {directors.map((d, i) => (
                <tr key={i}>
                  <td className={`${tdClass} text-center`}>
                    {directors.length > 1 && (
                      <button type="button" onClick={() => setDirectors(directors.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                  <td className={`${tdClass} text-center text-slate-500`}>{i + 1}</td>
                  <td className={tdClass}><input className={cellInputClass} value={d.name} onChange={e => updateDirector(i, { name: e.target.value })} /></td>
                  <td className={tdClass}><input type="date" className={cellInputClass} value={d.dateOfBirth} onChange={e => updateDirector(i, { dateOfBirth: e.target.value })} /></td>
                  <td className={tdClass}><input className={cellInputClass} value={d.phone} onChange={e => updateDirector(i, { phone: e.target.value })} /></td>
                  <td className={tdClass}><input className={cellInputClass} value={d.email} onChange={e => updateDirector(i, { email: e.target.value })} /></td>
                  <td className={tdClass}>
                    <select className={cellInputClass} value={d.identificationType} onChange={e => updateDirector(i, { identificationType: e.target.value })}>
                      {ID_TYPES_DIRECTOR.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className={tdClass}><input className={cellInputClass} value={d.identificationNumber} onChange={e => updateDirector(i, { identificationNumber: e.target.value })} /></td>
                  <td className={tdClass}><input className={cellInputClass} value={d.nationality} onChange={e => updateDirector(i, { nationality: e.target.value })} /></td>
                  <td className={tdClass}><input className={`${cellInputClass} min-w-[220px]`} value={d.address} onChange={e => updateDirector(i, { address: e.target.value })} /></td>
                  <td className={tdClass}><input type="date" className={cellInputClass} value={d.dateOfAppointment} onChange={e => updateDirector(i, { dateOfAppointment: e.target.value })} /></td>
                  <td className={`${tdClass} text-center`}>
                    <input type="checkbox" checked={d.isNomineeDirector}
                      onChange={e => updateDirector(i, { isNomineeDirector: e.target.checked, nominatorType: e.target.checked ? (d.nominatorType || 'individual') : '' })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {directors.some(d => d.isNomineeDirector) && (
          <div className="flex flex-col gap-3 mt-4">
            {directors.map((d, i) => d.isNomineeDirector && (
              <div key={i} className="rounded-md bg-slate-50 border border-slate-200 p-3">
                <div className="text-sm font-medium text-slate-600 mb-2">Nominee Director details — {d.name || `row ${i + 1}`}</div>
                <Field label="Nominator Type">
                  <select className={inputClass} value={d.nominatorType} onChange={e => updateDirector(i, { nominatorType: e.target.value as PostIncorporateDirector['nominatorType'] })}>
                    <option value="individual">Individual</option>
                    <option value="corporate entity">Corporate Entity</option>
                  </select>
                </Field>
                {d.nominatorType === 'individual' ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                    <Field label="Nominator Name"><input className={inputClass} value={d.nominatorIndName || ''} onChange={e => updateDirector(i, { nominatorIndName: e.target.value })} /></Field>
                    <Field label="Nominator Address"><input className={inputClass} value={d.nominatorIndAddress || ''} onChange={e => updateDirector(i, { nominatorIndAddress: e.target.value })} /></Field>
                    <Field label="Nominator Nationality"><input className={inputClass} value={d.nominatorIndNationality || ''} onChange={e => updateDirector(i, { nominatorIndNationality: e.target.value })} /></Field>
                    <Field label="Nominator ID Number"><input className={inputClass} value={d.nominatorIndIdentificationNumber || ''} onChange={e => updateDirector(i, { nominatorIndIdentificationNumber: e.target.value })} /></Field>
                    <Field label="Nominator Birth Date"><input type="date" className={inputClass} value={d.nominatorIndBirthDate || ''} onChange={e => updateDirector(i, { nominatorIndBirthDate: e.target.value })} /></Field>
                    <Field label="Nominator Email"><input className={inputClass} value={d.nominatorIndEmail || ''} onChange={e => updateDirector(i, { nominatorIndEmail: e.target.value })} /></Field>
                    <Field label="Nominator Contact No."><input className={inputClass} value={d.nominatorIndContactNumber || ''} onChange={e => updateDirector(i, { nominatorIndContactNumber: e.target.value })} /></Field>
                    <Field label="Date Became Nominator"><input type="date" className={inputClass} value={d.nominatorIndDateBecameNominator || ''} onChange={e => updateDirector(i, { nominatorIndDateBecameNominator: e.target.value })} /></Field>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                    <Field label="Nominator Corp Name"><input className={inputClass} value={d.nominatorCorpName || ''} onChange={e => updateDirector(i, { nominatorCorpName: e.target.value })} /></Field>
                    <Field label="Nominator Corp UEN"><input className={inputClass} value={d.nominatorCorpUen || ''} onChange={e => updateDirector(i, { nominatorCorpUen: e.target.value })} /></Field>
                    <Field label="Registered Address"><input className={inputClass} value={d.nominatorCorpRegisteredAddress || ''} onChange={e => updateDirector(i, { nominatorCorpRegisteredAddress: e.target.value })} /></Field>
                    <Field label="Legal Form"><input className={inputClass} value={d.nominatorCorpLegalForm || ''} onChange={e => updateDirector(i, { nominatorCorpLegalForm: e.target.value })} /></Field>
                    <Field label="Corp Representative"><input className={inputClass} value={d.nominatorCorpRepresentative || ''} onChange={e => updateDirector(i, { nominatorCorpRepresentative: e.target.value })} /></Field>
                    <Field label="Corp Email"><input className={inputClass} value={d.nominatorCorpEmail || ''} onChange={e => updateDirector(i, { nominatorCorpEmail: e.target.value })} /></Field>
                    <Field label="Corp Contact No."><input className={inputClass} value={d.nominatorCorpContactNumber || ''} onChange={e => updateDirector(i, { nominatorCorpContactNumber: e.target.value })} /></Field>
                    <Field label="Date Became Nominator"><input type="date" className={inputClass} value={d.nominatorCorpDateBecameNominator || ''} onChange={e => updateDirector(i, { nominatorCorpDateBecameNominator: e.target.value })} /></Field>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Secretary */}
      <section className={cardClass}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className={`${sectionTitleClass} mb-0`}>SECRETARY 秘书{parsedSuffix}</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium text-slate-600">SECRETARY 秘书</span>
              <select className={inputClass} value={company.secretaryName} onChange={e => setCompany({ ...company, secretaryName: e.target.value })}>
                <option value="">—</option>
                {secretaries.filter(s => s.name.trim()).map((s, idx) => <option key={idx} value={s.name}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <button type="button" onClick={() => setSecretaries([...secretaries, emptySecretary()])}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
            <Plus size={15} /> 新增一行 Add Row
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={`${thClass} w-7`}></th>
                <th className={`${thClass} w-9`}>No.</th>
                <th className={thClass}>Name</th>
                <th className={thClass}>ID Type</th>
                <th className={thClass}>Identification Number</th>
                <th className={thClass}>Nationality/Place of Origin</th>
                <th className={thClass}>Address</th>
                <th className={thClass}>Date of Appointment</th>
              </tr>
            </thead>
            <tbody>
              {secretaries.map((s, i) => (
                <tr key={i}>
                  <td className={`${tdClass} text-center`}>
                    {secretaries.length > 1 && (
                      <button type="button" onClick={() => {
                        const removedName = s.name;
                        setSecretaries(secretaries.filter((_, idx) => idx !== i));
                        setCompany(c => (c.secretaryName === removedName ? { ...c, secretaryName: '' } : c));
                      }} className="text-slate-400 hover:text-red-500">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                  <td className={`${tdClass} text-center text-slate-500`}>{i + 1}</td>
                  <td className={tdClass}>
                    <input className={cellInputClass} value={s.name} onChange={e => {
                      const prevName = s.name;
                      updateSecretary(i, { name: e.target.value });
                      setCompany(c => (c.secretaryName === prevName || !c.secretaryName ? { ...c, secretaryName: e.target.value } : c));
                    }} />
                  </td>
                  <td className={tdClass}>
                    <select className={cellInputClass} value={s.identificationType} onChange={e => updateSecretary(i, { identificationType: e.target.value })}>
                      {ID_TYPES_DIRECTOR.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className={tdClass}><input className={cellInputClass} value={s.identificationNumber} onChange={e => updateSecretary(i, { identificationNumber: e.target.value })} /></td>
                  <td className={tdClass}><input className={cellInputClass} value={s.nationality} onChange={e => updateSecretary(i, { nationality: e.target.value })} /></td>
                  <td className={tdClass}><input className={`${cellInputClass} min-w-[220px]`} value={s.address} onChange={e => updateSecretary(i, { address: e.target.value })} /></td>
                  <td className={tdClass}><input type="date" className={cellInputClass} value={s.dateOfAppointment} onChange={e => updateSecretary(i, { dateOfAppointment: e.target.value })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Shareholders */}
      <section className={cardClass}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <div className={`${sectionTitleClass} mb-0`}>Shareholder 股东{parsedSuffix}</div>
          <button type="button" onClick={() => setShareholders([...shareholders, emptyShareholder()])}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
            <Plus size={15} /> 新增一行 Add Row
          </button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className={`${thClass} w-7`}></th>
                <th className={`${thClass} w-9`}>No.</th>
                <th className={thClass}>Name</th>
                <th className={thClass}>Birth Date</th>
                <th className={thClass}>Contact No</th>
                <th className={thClass}>Email Address</th>
                <th className={thClass}>ID Type</th>
                <th className={thClass}>Identification Number</th>
                <th className={thClass}>Nationality/Place of Origin</th>
                <th className={thClass}>Address</th>
                <th className={thClass}>Number of Shares</th>
                <th className={thClass}>是否RORC</th>
                <th className={thClass}>Nominee</th>
              </tr>
            </thead>
            <tbody>
              {shareholders.map((s, i) => (
                <tr key={i}>
                  <td className={`${tdClass} text-center`}>
                    {shareholders.length > 1 && (
                      <button type="button" onClick={() => setShareholders(shareholders.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-500">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </td>
                  <td className={`${tdClass} text-center text-slate-500`}>{i + 1}</td>
                  <td className={tdClass}><input className={cellInputClass} value={s.name} onChange={e => updateShareholder(i, { name: e.target.value })} /></td>
                  <td className={tdClass}><input type="date" className={cellInputClass} value={s.dateOfBirth} onChange={e => updateShareholder(i, { dateOfBirth: e.target.value })} /></td>
                  <td className={tdClass}><input className={cellInputClass} value={s.phone} onChange={e => updateShareholder(i, { phone: e.target.value })} /></td>
                  <td className={tdClass}><input className={cellInputClass} value={s.email} onChange={e => updateShareholder(i, { email: e.target.value })} /></td>
                  <td className={tdClass}>
                    <select className={cellInputClass} value={s.identificationType} onChange={e => updateShareholder(i, { identificationType: e.target.value })}>
                      {ID_TYPES_SHAREHOLDER.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </td>
                  <td className={tdClass}><input className={cellInputClass} value={s.identificationNumber} onChange={e => updateShareholder(i, { identificationNumber: e.target.value })} /></td>
                  <td className={tdClass}><input className={cellInputClass} value={s.nationality} onChange={e => updateShareholder(i, { nationality: e.target.value })} /></td>
                  <td className={tdClass}><input className={`${cellInputClass} min-w-[220px]`} value={s.address} onChange={e => updateShareholder(i, { address: e.target.value })} /></td>
                  <td className={tdClass}><input className={cellInputClass} value={s.numberOfShares} onChange={e => updateShareholder(i, { numberOfShares: e.target.value })} /></td>
                  <td className={`${tdClass} text-center`}>
                    <select className={cellInputClass} value={s.isRorc ? 'YES' : 'NO'} onChange={e => updateShareholder(i, { isRorc: e.target.value === 'YES' })}>
                      <option value="NO">NO</option>
                      <option value="YES">YES</option>
                    </select>
                  </td>
                  <td className={`${tdClass} text-center`}>
                    <input type="checkbox" checked={!!s.isNomineeShareholder}
                      onChange={e => updateShareholder(i, { isNomineeShareholder: e.target.checked, nominatorType: e.target.checked ? (s.nominatorType || 'individual') : '' })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-4 mt-4">
          {shareholders.map((s, i) => {
            const isCorp = s.identificationType.trim().toUpperCase() === 'UEN';
            if (!isCorp && !s.fullyPaidUp && !s.isNomineeShareholder) return null;
            return (
              <div key={i} className="rounded-md bg-slate-50 border border-slate-200 p-3">
                <div className="text-sm font-medium text-slate-600 mb-2">Additional details — {s.name || `row ${i + 1}`}</div>

                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={s.fullyPaidUp} onChange={e => updateShareholder(i, { fullyPaidUp: e.target.checked })} />
                  <span>Fully paid-up (generates a Share Certificate)</span>
                </label>
                {s.fullyPaidUp && (
                  <div className="mt-2 max-w-xs">
                    <Field label="Share Certificate No."><input className={inputClass} value={s.shareCertificateNo || ''} onChange={e => updateShareholder(i, { shareCertificateNo: e.target.value })} /></Field>
                  </div>
                )}

                {isCorp && (
                  <div className="mt-3">
                    <div className="text-sm font-medium text-slate-600 mb-2">Corporate Shareholder Details</div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      <Field label="Corp Representative"><input className={inputClass} value={s.corpRepresentative || ''} onChange={e => updateShareholder(i, { corpRepresentative: e.target.value })} /></Field>
                      <Field label="Corp Rep ID Type"><input className={inputClass} value={s.corpRepIdType || ''} onChange={e => updateShareholder(i, { corpRepIdType: e.target.value })} /></Field>
                      <Field label="Corp Rep ID No."><input className={inputClass} value={s.corpRepIdNo || ''} onChange={e => updateShareholder(i, { corpRepIdNo: e.target.value })} /></Field>
                    </div>
                    <div className="mt-3">
                      <Field label="Corporate Director Names (one per line — at least one required)">
                        <textarea className={`${inputClass} min-h-[70px]`} value={(s.corporateDirectorNames || []).join('\n')}
                          onChange={e => updateShareholder(i, { corporateDirectorNames: e.target.value.split('\n') })} />
                      </Field>
                    </div>
                  </div>
                )}

                {s.isNomineeShareholder && (
                  <div className="mt-3">
                    <Field label="Nominator Type">
                      <select className={inputClass} value={s.nominatorType} onChange={e => updateShareholder(i, { nominatorType: e.target.value as PostIncorporateShareholder['nominatorType'] })}>
                        <option value="individual">Individual</option>
                        <option value="corporate entity">Corporate Entity</option>
                      </select>
                    </Field>
                    {s.nominatorType === 'individual' ? (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                        <Field label="Nominator Name"><input className={inputClass} value={s.nominatorIndName || ''} onChange={e => updateShareholder(i, { nominatorIndName: e.target.value })} /></Field>
                        <Field label="Nominator Address"><input className={inputClass} value={s.nominatorIndAddress || ''} onChange={e => updateShareholder(i, { nominatorIndAddress: e.target.value })} /></Field>
                        <Field label="Nominator Nationality"><input className={inputClass} value={s.nominatorIndNationality || ''} onChange={e => updateShareholder(i, { nominatorIndNationality: e.target.value })} /></Field>
                        <Field label="Nominator ID Number"><input className={inputClass} value={s.nominatorIndIdentificationNumber || ''} onChange={e => updateShareholder(i, { nominatorIndIdentificationNumber: e.target.value })} /></Field>
                        <Field label="Nominator Birth Date"><input type="date" className={inputClass} value={s.nominatorIndBirthDate || ''} onChange={e => updateShareholder(i, { nominatorIndBirthDate: e.target.value })} /></Field>
                        <Field label="Nominator Email"><input className={inputClass} value={s.nominatorIndEmail || ''} onChange={e => updateShareholder(i, { nominatorIndEmail: e.target.value })} /></Field>
                        <Field label="Nominator Contact No."><input className={inputClass} value={s.nominatorIndContactNumber || ''} onChange={e => updateShareholder(i, { nominatorIndContactNumber: e.target.value })} /></Field>
                        <Field label="Date Became Nominator"><input type="date" className={inputClass} value={s.nominatorIndDateBecameNominator || ''} onChange={e => updateShareholder(i, { nominatorIndDateBecameNominator: e.target.value })} /></Field>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                        <Field label="Nominator Corp Name"><input className={inputClass} value={s.nominatorCorpName || ''} onChange={e => updateShareholder(i, { nominatorCorpName: e.target.value })} /></Field>
                        <Field label="Nominator Corp UEN"><input className={inputClass} value={s.nominatorCorpUen || ''} onChange={e => updateShareholder(i, { nominatorCorpUen: e.target.value })} /></Field>
                        <Field label="Registered Address"><input className={inputClass} value={s.nominatorCorpRegisteredAddress || ''} onChange={e => updateShareholder(i, { nominatorCorpRegisteredAddress: e.target.value })} /></Field>
                        <Field label="Legal Form"><input className={inputClass} value={s.nominatorCorpLegalForm || ''} onChange={e => updateShareholder(i, { nominatorCorpLegalForm: e.target.value })} /></Field>
                        <Field label="Corp Representative"><input className={inputClass} value={s.nominatorCorpRepresentative || ''} onChange={e => updateShareholder(i, { nominatorCorpRepresentative: e.target.value })} /></Field>
                        <Field label="Corp Email"><input className={inputClass} value={s.nominatorCorpEmail || ''} onChange={e => updateShareholder(i, { nominatorCorpEmail: e.target.value })} /></Field>
                        <Field label="Corp Contact No."><input className={inputClass} value={s.nominatorCorpContactNumber || ''} onChange={e => updateShareholder(i, { nominatorCorpContactNumber: e.target.value })} /></Field>
                        <Field label="Date Became Nominator"><input type="date" className={inputClass} value={s.nominatorCorpDateBecameNominator || ''} onChange={e => updateShareholder(i, { nominatorCorpDateBecameNominator: e.target.value })} /></Field>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
          className="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium px-5 py-2.5 text-sm">
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {submitting ? 'Generating…' : 'Generate Documents (ZIP)'}
        </button>
      </div>
    </div>
  );
}
