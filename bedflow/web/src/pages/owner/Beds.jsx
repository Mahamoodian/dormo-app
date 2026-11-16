import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { get, patch } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLoad, useAction, Spinner, ErrorBox, PageHeader, Modal, Empty, Badge, SearchInput, Field, MoneyInput } from '../../components/ui.jsx';
import AssignModal from '../../components/AssignModal.jsx';
import VacateModal from '../../components/VacateModal.jsx';
import CollectModal from '../../components/CollectModal.jsx';
import { IconPhone, IconBuilding } from '../../components/icons.jsx';
import { money, fmtDate, freqLabel } from '../../lib/format.js';

const statusStyle = {
  available: { label: 'Available', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500', badge: 'green' },
  occupied: { label: 'Occupied', cls: 'border-brand-200 bg-white text-slate-800', dot: 'bg-brand-600', badge: 'blue' },
  overdue: { label: 'Overdue', cls: 'border-rose-300 bg-rose-50 text-rose-800', dot: 'bg-rose-500', badge: 'red' },
  maintenance: { label: 'Maintenance', cls: 'border-amber-200 bg-amber-50 text-amber-800', dot: 'bg-amber-500', badge: 'amber' },
};

export default function Beds() {
  const { user } = useAuth();
  const cur = user.currency;
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') || 'all';
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(() => get('/properties/tree'));
  const [sel, setSel] = useState(null);
  const [action, setAction] = useState(null); // 'assign' | 'vacate' | 'collect' | 'terms'

  const flatBeds = useMemo(() => {
    if (!data) return [];
    const out = [];
    data.buildings.forEach((b) => b.flats.forEach((f) => f.areas.forEach((a) => a.beds.forEach((bd) =>
      out.push({ ...bd, building: b.name, flat: f.name, area: a.name, flat_id: f.id, path: `${b.name} › ${f.name} › ${a.name}` })))));
    return out;
  }, [data]);

  const counts = useMemo(() => flatBeds.reduce((c, b) => ({ ...c, [b.status]: (c[b.status] || 0) + 1 }), {}), [flatBeds]);
  const shown = flatBeds.filter((b) =>
    (filter === 'all' || b.status === filter || (filter === 'occupied' && b.status === 'overdue')) &&
    (!q || `${b.label} ${b.client_name || ''} ${b.path}`.toLowerCase().includes(q.toLowerCase())));

  // group shown beds by flat > area
  const groups = useMemo(() => {
    const g = new Map();
    shown.forEach((b) => {
      const key = `${b.building} › ${b.flat}`;
      if (!g.has(key)) g.set(key, new Map());
      const areas = g.get(key);
      if (!areas.has(b.area)) areas.set(b.area, []);
      areas.get(b.area).push(b);
    });
    return g;
  }, [shown]);

  const done = () => { setAction(null); setSel(null); reload(); };

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!flatBeds.length) {
    return (<><PageHeader title="Beds" />
      <Empty title="No beds yet" action={<Link to="/properties" className="btn-primary"><IconBuilding />Set up properties</Link>}>
        Add buildings, flats, areas and beds first.</Empty></>);
  }

  const chips = [['all', 'All', flatBeds.length], ['available', 'Available', counts.available || 0],
    ['occupied', 'Occupied', (counts.occupied || 0) + (counts.overdue || 0)], ['overdue', 'Overdue', counts.overdue || 0],
    ['maintenance', 'Maintenance', counts.maintenance || 0]];

  const tenancy = sel && sel.assignment_id ? {
    id: sel.assignment_id, client_name: sel.client_name, start_date: sel.start_date, path: `${sel.path} › ${sel.label}`,
  } : null;

  return (
    <>
      <PageHeader title="Beds" subtitle={`${counts.available || 0} available of ${flatBeds.length}`} />
      <div className="mb-3"><SearchInput value={q} onChange={setQ} placeholder="Search bed, client, flat…" /></div>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {chips.map(([k, l, n]) => (
          <button key={k} onClick={() => setParams(k === 'all' ? {} : { filter: k })}
            className={`min-h-[38px] whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold ${
              filter === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600'}`}>
            {l} <span className="opacity-60">{n}</span>
          </button>
        ))}
      </div>

      {!shown.length && <Empty title="No beds match this filter" />}
      <div className="space-y-5">
        {[...groups.entries()].map(([flat, areas]) => (
          <section key={flat}>
            <h2 className="mb-2 text-sm font-bold text-slate-700">{flat}</h2>
            <div className="space-y-3">
              {[...areas.entries()].map(([area, beds]) => (
                <div key={area}>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{area}</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {beds.map((b) => {
                      const s = statusStyle[b.status];
                      return (
                        <button key={b.id} onClick={() => setSel(b)} className={`rounded-2xl border p-3 text-left shadow-card transition active:scale-[.98] ${s.cls}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">{b.label}</span><span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} />
                          </div>
                          {b.assignment_id ? (
                            <>
                              <div className="mt-1 truncate text-sm">{b.client_name}</div>
                              <div className="mt-0.5 text-xs opacity-75">
                                {b.status === 'overdue' ? `Due ${money(b.overdue_balance, cur)}` : `Until ${fmtDate(b.current_period_end)}`}
                              </div>
                            </>
                          ) : (
                            <div className="mt-1 text-sm opacity-80">{s.label}{b.default_rent ? ` · ${money(b.default_rent, cur)}` : ''}</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Bed action sheet */}
      <Modal open={!!sel && !action} onClose={() => setSel(null)} size="sm" title={sel?.label} subtitle={sel?.path}>
        {sel && (
          <div className="space-y-4">
            <Badge color={statusStyle[sel.status].badge}>{statusStyle[sel.status].label}</Badge>
            {sel.assignment_id ? (
              <>
                <div className="rounded-2xl bg-slate-50 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <Link to={`/clients/${sel.client_id}`} className="font-semibold text-brand-800 underline-offset-2 hover:underline">{sel.client_name}</Link>
                    {sel.client_phone && <a href={`tel:${sel.client_phone}`} className="btn-secondary min-h-[36px] px-3 text-xs"><IconPhone className="h-4 w-4" />Call</a>}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div>Rent<div className="tabular text-sm font-semibold text-slate-900">{money(sel.rent_amount, cur)} <span className="font-normal text-slate-500">{freqLabel(sel.frequency_unit, sel.frequency_count)}</span></div></div>
                    <div>Paid period ends<div className="text-sm font-semibold text-slate-900">{fmtDate(sel.current_period_end)}</div></div>
                    <div>Since<div className="text-sm font-semibold text-slate-900">{fmtDate(sel.start_date)}</div></div>
                    <div>Overdue<div className={`tabular text-sm font-semibold ${Number(sel.overdue_balance) ? 'text-rose-600' : 'text-slate-900'}`}>{money(sel.overdue_balance, cur)}</div></div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-primary" onClick={() => setAction('collect')}>Collect</button>
                  <button className="btn-secondary" onClick={() => setAction('terms')}>Edit terms</button>
                  <Link to={`/clients/${sel.client_id}`} className="btn-secondary">Client file</Link>
                  <button className="btn-secondary text-rose-600" onClick={() => setAction('vacate')}>Vacate</button>
                </div>
              </>
            ) : sel.status === 'available' ? (
              <button className="btn-primary w-full" onClick={() => setAction('assign')}>Assign client</button>
            ) : (
              <p className="text-sm text-slate-500">This bed is under maintenance. Change it in Properties to make it assignable.</p>
            )}
          </div>
        )}
      </Modal>

      <AssignModal open={action === 'assign'} bed={sel && { ...sel, path: sel.path }} onClose={() => setAction(null)} onDone={done} />
      <VacateModal open={action === 'vacate'} tenancy={tenancy} onClose={() => setAction(null)} onDone={done} />
      <CollectModal open={action === 'collect'} onClose={() => setAction(null)} onDone={done}
        target={sel && { assignmentId: sel.assignment_id, balance: Number(sel.overdue_balance) || sel.rent_amount, title: sel.client_name,
          subtitle: Number(sel.overdue_balance) ? 'Pays oldest dues first.' : 'No dues yet — this pre-pays the next period.' }} />
      <TermsModal open={action === 'terms'} bed={sel} beds={flatBeds} onClose={() => setAction(null)} onDone={done} />
    </>
  );
}

function TermsModal({ open, bed, beds, onClose, onDone }) {
  const { user } = useAuth();
  const [run, busy] = useAction();
  const [f, setF] = useState(null);
  if (open && bed && (!f || f.id !== bed.assignment_id)) {
    setF({ id: bed.assignment_id, rent_amount: bed.rent_amount, frequency_unit: bed.frequency_unit, frequency_count: bed.frequency_count,
      current_period_end: bed.current_period_end, bed_id: bed.id });
  }
  if (!open || !f) return null;
  const free = beds.filter((b) => b.status === 'available' || b.id === bed.id);
  const submit = async (e) => {
    e.preventDefault();
    const body = { rent_amount: Number(f.rent_amount), frequency_unit: f.frequency_unit, frequency_count: Number(f.frequency_count) };
    if (f.current_period_end !== bed.current_period_end) body.current_period_end = f.current_period_end;
    if (f.bed_id !== bed.id) body.bed_id = f.bed_id;
    await run(() => patch(`/assignments/${f.id}`, body), 'Tenancy updated');
    setF(null);
    onDone();
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Edit tenancy terms" subtitle={bed.client_name}
      footer={<><button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex-1" form="termsForm" disabled={busy}>Save</button></>}>
      <form id="termsForm" onSubmit={submit} className="space-y-4">
        <Field label={`Rent per period (${user.currency})`} hint="Applies to periods billed from now on">
          <MoneyInput value={f.rent_amount} onChange={(v) => setF({ ...f, rent_amount: v })} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Every"><input className="input" type="number" min="1" value={f.frequency_count} onChange={(e) => setF({ ...f, frequency_count: e.target.value })} /></Field>
          <Field label="Unit">
            <select className="input" value={f.frequency_unit} onChange={(e) => setF({ ...f, frequency_unit: e.target.value })}>
              <option value="day">Days</option><option value="week">Weeks</option><option value="month">Months</option>
            </select>
          </Field>
        </div>
        <Field label="Current period expiry" hint="Extend or shorten the current paid period / custom due date">
          <input className="input" type="date" value={f.current_period_end} onChange={(e) => setF({ ...f, current_period_end: e.target.value })} />
        </Field>
        <Field label="Transfer to bed">
          <select className="input" value={f.bed_id} onChange={(e) => setF({ ...f, bed_id: e.target.value })}>
            {free.map((b) => <option key={b.id} value={b.id}>{b.path} › {b.label}{b.id === bed.id ? ' (current)' : ''}</option>)}
          </select>
        </Field>
      </form>
    </Modal>
  );
}
