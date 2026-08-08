'use client';

import { useState } from 'react';
import { Plus, Trash2, Loader2, FileSignature, Download } from 'lucide-react';
import type { PostIncorporateCompany, PostIncorporateDirector, PostIncorporateShareholder } from '@/lib/docx-post-incorporate';

const ID_TYPES_DIRECTOR = ['NRIC', 'PASSPORT', 'FIN'];
const ID_TYPES_SHAREHOLDER = ['NRIC', 'PASSPORT', 'FIN', 'UEN'];

function emptyCompany(): PostIncorporateCompany {
  return {
    name: '', uen: '', address: '', regDate: '', chairmanName: '', secretaryName: '',
    secretaryCompanyName: '', secretaryCompanyAddress: '', currency: 'SGD',
    financialYearEndDayMonth: '', needNdService: false,
  };
}

function emptyDirector(): PostIncorporateDirector {
  return {
    name: '', address: '', identificationType: 'NRIC', identificationNumber: '',
    nationality: '', dateOfBirth: '', gender: '', email: '', phone: '',
    isNomineeDirector: false, nominatorType: '',
  };
}

function emptyShareholder(): PostIncorporateShareholder {
  return {
    name: '', address: '', identificationType: 'NRIC', identificationNumber: '',
    numberOfShares: '', paidUpCapital: '', fullyPaidUp: false, shareCertificateNo: '',
    corporateDirectorNames: [], corpRepresentative: '', corpRepIdType: '', corpRepIdNo: '',
    isNomineeShareholder: false, nominatorType: '',
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
const cardClass = 'rounded-xl border border-slate-200 bg-white p-5 shadow-sm';
const sectionTitleClass = 'text-base font-semibold text-slate-800 mb-4';

export default function PostIncorporatePage() {
  const [company, setCompany] = useState<PostIncorporateCompany>(emptyCompany());
  const [directors, setDirectors] = useState<PostIncorporateDirector[]>([emptyDirector()]);
  const [shareholders, setShareholders] = useState<PostIncorporateShareholder[]>([emptyShareholder()]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [success, setSuccess] = useState<string | null>(null);

  const updateDirector = (index: number, patch: Partial<PostIncorporateDirector>) =>
    setDirectors(current => current.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  const updateShareholder = (index: number, patch: Partial<PostIncorporateShareholder>) =>
    setShareholders(current => current.map((s, i) => (i === index ? { ...s, ...patch } : s)));

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

  return (
    <div className="p-6 max-w-5xl mx-auto flex flex-col gap-6">
      <div className="mb-1 text-sm text-slate-500">Dashboard › Post Incorporate</div>
      <div className="flex items-center gap-2">
        <FileSignature size={22} className="text-blue-600" />
        <h1 className="text-xl font-semibold text-slate-800">Post Incorporate — Tassure Document Generator</h1>
      </div>
      <p className="text-sm text-slate-500 -mt-3">
        Fills the Post Incorporate (Tassure) document set from the details below and downloads a ZIP.
        Staff then file the ZIP's contents into the client's network folder manually, as usual.
      </p>

      {/* Company */}
      <section className={cardClass}>
        <div className={sectionTitleClass}>Company Information</div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label="Company Name"><input className={inputClass} value={company.name} onChange={e => setCompany({ ...company, name: e.target.value })} /></Field>
          <Field label="UEN"><input className={inputClass} value={company.uen} onChange={e => setCompany({ ...company, uen: e.target.value })} /></Field>
          <Field label="Registration Date"><input type="date" className={inputClass} value={company.regDate} onChange={e => setCompany({ ...company, regDate: e.target.value })} /></Field>
          <Field label="Registered Address"><input className={inputClass} value={company.address} onChange={e => setCompany({ ...company, address: e.target.value })} /></Field>
          <Field label="Chairman (must match a director's name)"><input className={inputClass} value={company.chairmanName} onChange={e => setCompany({ ...company, chairmanName: e.target.value })} /></Field>
          <Field label="Secretary Name"><input className={inputClass} value={company.secretaryName} onChange={e => setCompany({ ...company, secretaryName: e.target.value })} /></Field>
          <Field label="Secretarial Firm Name"><input className={inputClass} value={company.secretaryCompanyName} onChange={e => setCompany({ ...company, secretaryCompanyName: e.target.value })} /></Field>
          <Field label="Secretarial Firm Address"><input className={inputClass} value={company.secretaryCompanyAddress} onChange={e => setCompany({ ...company, secretaryCompanyAddress: e.target.value })} /></Field>
          <Field label="Currency"><input className={inputClass} value={company.currency} onChange={e => setCompany({ ...company, currency: e.target.value })} /></Field>
          <Field label="Financial Year End (e.g. 31 December)"><input className={inputClass} value={company.financialYearEndDayMonth} onChange={e => setCompany({ ...company, financialYearEndDayMonth: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm mt-4">
          <input type="checkbox" checked={company.needNdService} onChange={e => setCompany({ ...company, needNdService: e.target.checked })} />
          <span>Company needs Nominee Director (ND) service — generates the ND Agreement</span>
        </label>
      </section>

      {/* Directors */}
      <section className={cardClass}>
        <div className="flex items-center justify-between mb-4">
          <div className={`${sectionTitleClass} mb-0`}>Directors</div>
          <button type="button" onClick={() => setDirectors([...directors, emptyDirector()])}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
            <Plus size={15} /> Add Director
          </button>
        </div>
        <div className="flex flex-col gap-5">
          {directors.map((d, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-4 relative">
              {directors.length > 1 && (
                <button type="button" onClick={() => setDirectors(directors.filter((_, idx) => idx !== i))}
                  className="absolute top-3 right-3 text-slate-400 hover:text-red-500">
                  <Trash2 size={15} />
                </button>
              )}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Name"><input className={inputClass} value={d.name} onChange={e => updateDirector(i, { name: e.target.value })} /></Field>
                <Field label="Address"><input className={inputClass} value={d.address} onChange={e => updateDirector(i, { address: e.target.value })} /></Field>
                <Field label="ID Type">
                  <select className={inputClass} value={d.identificationType} onChange={e => updateDirector(i, { identificationType: e.target.value })}>
                    {ID_TYPES_DIRECTOR.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </Field>
                <Field label="ID Number"><input className={inputClass} value={d.identificationNumber} onChange={e => updateDirector(i, { identificationNumber: e.target.value })} /></Field>
                <Field label="Nationality"><input className={inputClass} value={d.nationality} onChange={e => updateDirector(i, { nationality: e.target.value })} /></Field>
                <Field label="Date of Birth"><input type="date" className={inputClass} value={d.dateOfBirth} onChange={e => updateDirector(i, { dateOfBirth: e.target.value })} /></Field>
                <Field label="Gender"><input className={inputClass} value={d.gender} onChange={e => updateDirector(i, { gender: e.target.value })} /></Field>
                <Field label="Email"><input className={inputClass} value={d.email} onChange={e => updateDirector(i, { email: e.target.value })} /></Field>
                <Field label="Phone"><input className={inputClass} value={d.phone} onChange={e => updateDirector(i, { phone: e.target.value })} /></Field>
              </div>

              <label className="flex items-center gap-2 text-sm mt-3">
                <input type="checkbox" checked={d.isNomineeDirector} onChange={e => updateDirector(i, { isNomineeDirector: e.target.checked, nominatorType: e.target.checked ? (d.nominatorType || 'individual') : '' })} />
                <span>Nominee Director</span>
              </label>

              {d.isNomineeDirector && (
                <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 p-3">
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
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Shareholders */}
      <section className={cardClass}>
        <div className="flex items-center justify-between mb-4">
          <div className={`${sectionTitleClass} mb-0`}>Shareholders</div>
          <button type="button" onClick={() => setShareholders([...shareholders, emptyShareholder()])}
            className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
            <Plus size={15} /> Add Shareholder
          </button>
        </div>
        <div className="flex flex-col gap-5">
          {shareholders.map((s, i) => {
            const isCorp = s.identificationType.trim().toUpperCase() === 'UEN';
            return (
              <div key={i} className="rounded-lg border border-slate-200 p-4 relative">
                {shareholders.length > 1 && (
                  <button type="button" onClick={() => setShareholders(shareholders.filter((_, idx) => idx !== i))}
                    className="absolute top-3 right-3 text-slate-400 hover:text-red-500">
                    <Trash2 size={15} />
                  </button>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Field label="Name"><input className={inputClass} value={s.name} onChange={e => updateShareholder(i, { name: e.target.value })} /></Field>
                  <Field label="Address"><input className={inputClass} value={s.address} onChange={e => updateShareholder(i, { address: e.target.value })} /></Field>
                  <Field label="ID Type">
                    <select className={inputClass} value={s.identificationType} onChange={e => updateShareholder(i, { identificationType: e.target.value })}>
                      {ID_TYPES_SHAREHOLDER.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="ID Number"><input className={inputClass} value={s.identificationNumber} onChange={e => updateShareholder(i, { identificationNumber: e.target.value })} /></Field>
                  <Field label="No. of Shares"><input className={inputClass} value={s.numberOfShares} onChange={e => updateShareholder(i, { numberOfShares: e.target.value })} /></Field>
                  <Field label="Paid-Up Capital"><input className={inputClass} value={s.paidUpCapital} onChange={e => updateShareholder(i, { paidUpCapital: e.target.value })} /></Field>
                </div>

                <label className="flex items-center gap-2 text-sm mt-3">
                  <input type="checkbox" checked={s.fullyPaidUp} onChange={e => updateShareholder(i, { fullyPaidUp: e.target.checked })} />
                  <span>Fully paid-up (generates a Share Certificate)</span>
                </label>
                {s.fullyPaidUp && (
                  <div className="mt-2 max-w-xs">
                    <Field label="Share Certificate No."><input className={inputClass} value={s.shareCertificateNo || ''} onChange={e => updateShareholder(i, { shareCertificateNo: e.target.value })} /></Field>
                  </div>
                )}

                {isCorp && (
                  <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 p-3">
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

                <label className="flex items-center gap-2 text-sm mt-3">
                  <input type="checkbox" checked={!!s.isNomineeShareholder} onChange={e => updateShareholder(i, { isNomineeShareholder: e.target.checked, nominatorType: e.target.checked ? (s.nominatorType || 'individual') : '' })} />
                  <span>Nominee Shareholder</span>
                </label>

                {s.isNomineeShareholder && (
                  <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 p-3">
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
