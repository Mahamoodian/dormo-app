import { useParams, Link } from 'react-router-dom';
import { get } from '../../api/client.js';
import { useLoad, Spinner, ErrorBox, PageHeader, Badge, Stat } from '../../components/ui.jsx';
import { money, fmtDate } from '../../lib/format.js';
import { StatusBadge } from './AdminReports.jsx';

/** Read-only view of a business owner's data. No edit controls by design. */
export default function AdminUserView() {
  const { id } = useParams();
  const { data, error, loading, reload } = useLoad(() => get(`/admin/users/${id}/view`), [id]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { owner, properties, clients, expenses, receivables } = data;
  const cur = owner.currency;
  const beds = properties.filter((p) => p.bed_id);
  const occupied = beds.filter((b) => b.occupied).length;

  // group bed rows -> building > flat
  const groups = {};
  properties.forEach((p) => {
    const key = `${p.building}${p.flat ? ` › ${p.flat}` : ''}`;
    (groups[key] ||= []).push(p);
  });

  return (
    <>
      <Link to="/admin/users" className="text-sm font-semibold text-brand-700">← Users</Link>
      <PageHeader title={owner.business_name || owner.full_name} subtitle={`${owner.full_name} · ${owner.email}`}
        actions={<><StatusBadge u={owner} /><Badge color="blue">Read-only view</Badge></>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Beds" value={beds.length} sub={`${occupied} occupied`} />
        <Stat label="Clients" value={clients.length} sub={`${clients.filter((c) => c.active).length} in residence`} />
        <Stat label="Outstanding" value={money(receivables.outstanding, cur)} />
        <Stat label="Overdue" value={money(receivables.overdue, cur)} tone={Number(receivables.overdue) ? 'bad' : 'default'} />
      </div>

      <h2 className="mb-3 mt-8 font-semibold">Properties</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {Object.entries(groups).map(([k, rows]) => (
          <div key={k} className="card p-4">
            <div className="font-semibold">{k}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {rows.filter((r) => r.bed_id).map((r) => (
                <span key={r.bed_id} title={r.occupant || ''}
                  className={`rounded-lg px-2 py-1 text-xs font-medium ${r.occupied ? 'bg-brand-100 text-brand-800' : r.in_service ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-800'}`}>
                  {r.area} · {r.bed}
                </span>
              ))}
              {!rows.some((r) => r.bed_id) && <span className="text-xs text-slate-400">No beds</span>}
            </div>
          </div>
        ))}
        {!properties.length && <p className="text-sm text-slate-500">No properties yet.</p>}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 font-semibold">Clients</h2>
          <div className="card divide-y divide-slate-100">
            {clients.slice(0, 50).map((c) => (
              <div key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>{c.full_name}</span>{c.active ? <Badge color="green">Resident</Badge> : <Badge>Past</Badge>}
              </div>
            ))}
            {!clients.length && <p className="p-4 text-sm text-slate-500">No clients.</p>}
          </div>
        </div>
        <div>
          <h2 className="mb-3 font-semibold">Recent expenses</h2>
          <div className="card divide-y divide-slate-100">
            {expenses.slice(0, 50).map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0"><div className="truncate">{e.category} · {e.flat}</div>
                  <div className="text-xs text-slate-500">{fmtDate(e.expense_date)}{e.description ? ` · ${e.description}` : ''}</div></div>
                <span className="tabular font-semibold">{money(e.amount, cur)}</span>
              </div>
            ))}
            {!expenses.length && <p className="p-4 text-sm text-slate-500">No expenses.</p>}
          </div>
        </div>
      </div>
    </>
  );
}
