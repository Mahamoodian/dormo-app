import { Link } from 'react-router-dom';
import { get } from '../../api/client.js';
import { useLoad, Stat, Spinner, ErrorBox, PageHeader, Badge } from '../../components/ui.jsx';
import { fmtDateTime, num } from '../../lib/format.js';

export default function AdminReports() {
  const { data, error, loading, reload } = useLoad(() => get('/admin/reports'));
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const t = data.totals;
  return (
    <>
      <PageHeader title="Platform reports" subtitle="User-wise macro metrics. Operational records stay private to each business." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Business users" value={num(t.users)} sub={`${t.active_users} active · ${t.disabled_users} disabled`} />
        <Stat label="Pending first login" value={num(t.pending_first_login)} tone={t.pending_first_login ? 'warn' : 'default'} />
        <Stat label="Beds on platform" value={num(t.beds)} sub={`${num(t.buildings)} buildings · ${num(t.flats)} flats`} />
        <Stat label="Platform occupancy" value={`${t.platform_occupancy}%`} sub={`${num(t.occupied_beds)} occupied`} tone="good" />
      </div>

      <h2 className="mb-3 mt-8 font-semibold">Per-user overview</h2>
      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {data.users.map((u) => (
          <Link key={u.id} to={`/admin/users/${u.id}`} className="card block p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold">{u.business_name || u.full_name}</div>
                <div className="truncate text-xs text-slate-500">{u.email}</div>
              </div>
              <StatusBadge u={u} />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
              {[['Bldg', u.buildings], ['Beds', u.beds], ['Occ.', `${u.occupancy_rate}%`], ['Clients', u.clients]].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 py-2"><div className="tabular font-bold">{v}</div><div className="text-slate-500">{k}</div></div>
              ))}
            </div>
          </Link>
        ))}
      </div>
      {/* Desktop table */}
      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>{['Business', 'Status', 'Buildings', 'Flats', 'Beds', 'Occupancy', 'Clients', 'Overdue items', 'Last login'].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.users.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3"><Link className="font-semibold text-brand-800 hover:underline" to={`/admin/users/${u.id}`}>{u.business_name || u.full_name}</Link>
                  <div className="text-xs text-slate-500">{u.email}</div></td>
                <td className="px-4 py-3"><StatusBadge u={u} /></td>
                <td className="tabular px-4 py-3">{u.buildings}</td>
                <td className="tabular px-4 py-3">{u.flats}</td>
                <td className="tabular px-4 py-3">{u.beds}</td>
                <td className="tabular px-4 py-3">{u.occupied_beds}/{u.beds} <span className="text-slate-500">({u.occupancy_rate}%)</span></td>
                <td className="tabular px-4 py-3">{u.clients}</td>
                <td className="tabular px-4 py-3">{Number(u.overdue_items) ? <Badge color="red">{u.overdue_items}</Badge> : '0'}</td>
                <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(u.last_login_at)}</td>
              </tr>
            ))}
            {!data.users.length && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No users yet</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function StatusBadge({ u }) {
  if (!u.is_active) return <Badge color="red">Disabled</Badge>;
  if (u.must_change_password) return <Badge color="amber">Pending login</Badge>;
  return <Badge color="green">Active</Badge>;
}
