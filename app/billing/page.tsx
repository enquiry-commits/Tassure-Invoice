export default function BillingPage() {
  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Billing Drafts</div>
      <div className="bg-white rounded-xl shadow-sm p-12 text-center">
        <div className="text-5xl mb-4">📄</div>
        <h2 className="text-xl font-bold text-slate-700 mb-2">Billing Draft Generation</h2>
        <p className="text-slate-500 text-sm max-w-md mx-auto mb-6">
          This module will compare scraped client data with QuickBooks invoices and generate
          billing drafts for human review. <strong>No invoices will be sent automatically.</strong>
        </p>
        <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto text-left">
          {[
            { step: '1', label: 'Sync QuickBooks Data',      status: 'pending' },
            { step: '2', label: 'Match with CSS Clients',    status: 'pending' },
            { step: '3', label: 'Generate Draft Invoices',   status: 'pending' },
          ].map(({ step, label, status }) => (
            <div key={step} className="bg-slate-50 rounded-lg p-4 text-center">
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-sm font-bold text-slate-500 mx-auto mb-2">
                {step}
              </div>
              <div className="text-xs font-medium text-slate-600">{label}</div>
              <div className="text-xs text-slate-400 mt-1 capitalize">{status}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 mt-8">Coming soon · QuickBooks integration required</p>
      </div>
    </div>
  );
}
