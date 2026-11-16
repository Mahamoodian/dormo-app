import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLoad, Stat, Spinner, ErrorBox, PageHeader, Empty } from '../../components/ui.jsx';
import { money, fmtDate, num } from '../../lib/format.js';
import { IconCash, IconBed, IconReceipt, IconBuilding } from '../../components/icons.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, error, loading, reload } = useLoad(() => get('/dashboard', { month }), [month]);
  const cur = user.currency;
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const d = data;
  const collectPct = Number(d.revenue.rent_billed) ? Math.min(100, Math.round((d.revenue.rent_collected / d.revenue.rent_billed) * 100)) : 0;

  if (!Number(d.beds.total)) {
    return (
      <>
        <PageHeader title={`Welcome, ${user.full_name.split(' ')[0]}`} />
        <Empty title="Set up your first property" action={<Link to="/properties" className="btn-primary"><IconBuilding />Add a building</Link>}>
          Create a building, then flats or dormitories, areas (rooms) and beds. You can then assign clients and start collecting rent.
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Dashboard" subtitle={user.business_name || user.full_name}
        actions={<input type="month" className="input w-auto" value={month} onChange={(e) => setMonth(e.target.value)} />} />

      {Number(d.receivables.overdue) > 0 && (
        <Link to="/receivables" className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-rose-600 px-4 py-3 text-white shadow-card">
          <div>
            <div className="text-sm font-semibold">{money(d.receivables.overdue, cur)} overdue</div>
            <div className="text-xs text-rose-100">{d.receivables.overdue_clients} client(s) need collection</div>
          </div>
          <span className="rounded-lg bg-white/15 px-3 py-1.5 text-sm font-semibold">Collect →</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Occupancy" icon={<IconBed className="h-4 w-4" />} value={`${d.beds.occupancy_rate}%`}
          sub={`${d.beds.occupied}/${d.beds.total} beds · ${d.beds.available} free`} tone="good" />
        <Stat label="Rent collected" icon={<IconCash className="h-4 w-4" />} value={money(d.revenue.rent_collected, cur)}
          sub={`of ${money(d.revenue.rent_billed, cur)} billed this month`} />
        <Stat label="Receivables" value={money(d.receivables.outstanding, cur)} tone={Number(d.receivables.overdue) ? 'bad' : 'default'}
          sub={`${money(d.receivables.overdue, cur)} overdue`} />
        <Stat label="Expenses" icon={<IconReceipt className="h-4 w-4" />} value={money(d.revenue.expenses, cur)}
          sub={`Net ${money(d.revenue.net, cur)}`} tone={d.revenue.net < 0 ? 'bad' : 'default'} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Collected vs billed</h2>
            <span className="tabular text-sm font-semibold text-slate-600">{collectPct}%</span>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${collectPct}%` }} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[['Rent collected', d.revenue.rent_collected], ['Deposit retained', d.revenue.deposit_converted],
              ['Deposits held', d.deposits_held], ['Expiring ≤7 days', null, d.expiring_soon]].map(([k, v, raw]) => (
              <div key={k}><dt className="text-xs text-slate-500">{k}</dt><dd className="tabular font-semibold">{raw !== undefined ? num(raw) : money(v, cur)}</dd></div>
            ))}
          </dl>
        </div>
        <div className="card p-4">
          <h2 className="font-semibold">Quick actions</h2>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Link to="/receivables" className="btn-primary">Collect rent</Link>
            <Link to="/beds?filter=available" className="btn-secondary">Assign bed</Link>
            <Link to="/expenses?new=1" className="btn-secondary">Add expense</Link>
            <Link to="/clients" className="btn-secondary">Clients</Link>
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-1">
          <h2 className="mb-3 font-semibold">Occupancy by flat</h2>
          <div className="space-y-3">
            {d.flats.map((f) => {
              const pct = Number(f.beds) ? Math.round((f.occupied / f.beds) * 100) : 0;
              return (
                <div key={f.id}>
                  <div className="flex justify-between text-sm"><span className="truncate">{f.building_name} › {f.name}</span>
                    <span className="tabular text-slate-500">{f.occupied}/{f.beds}</span></div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand-500" style={{ width: `${pct}%` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
        <ListCard title="Recent collections" link="/receivables" rows={d.recent_payments.map((p) => ({
          id: p.id, title: p.client_name, sub: `${fmtDate(p.paid_on)} · ${p.kind === 'deposit' ? 'Deposit' : 'Rent'} · ${p.method.replace('_', ' ')}`, amount: money(p.amount, cur),
        }))} />
        <ListCard title="Recent expenses" link="/expenses" rows={d.recent_expenses.map((e) => ({
          id: e.id, title: `${e.category_name} · ${e.flat_name}`, sub: `${fmtDate(e.expense_date)}${e.description ? ` · ${e.description}` : ''}`, amount: money(e.amount, cur),
        }))} />
      </div>
    </>
  );
}

function ListCard({ title, rows, link }) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">{title}</h2>
        <Link to={link} className="text-sm font-semibold text-brand-700">View all</Link></div>
      <div className="divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0"><div className="truncate text-sm font-medium">{r.title}</div><div className="truncate text-xs text-slate-500">{r.sub}</div></div>
            <div className="tabular text-sm font-semibold">{r.amount}</div>
          </div>
        ))}
        {!rows.length && <p className="py-4 text-sm text-slate-500">Nothing yet.</p>}
      </div>
    </div>
  );
}
