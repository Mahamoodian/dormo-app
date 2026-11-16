import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLoad, useAction, Spinner, ErrorBox, PageHeader, Tabs, Empty, Badge, SearchInput, Modal } from '../../components/ui.jsx';
import { IconPlus, IconChevron } from '../../components/icons.jsx';
import { money, fmtDate, bedPath } from '../../lib/format.js';
import { ClientFields, blankClient } from './ClientDetail.jsx';

export default function Clients() {
  const { user } = useAuth();
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const { data, error, loading, reload } = useLoad(() => get('/clients', { status, q: dq }), [status, dq]);
  const [form, setForm] = useState(null);
  const [run, busy] = useAction();

  const create = async (e) => {
    e.preventDefault();
    await run(() => post('/clients', form), 'Client added');
    setForm(null);
    reload();
  };

  return (
    <>
      <PageHeader title="Client register" subtitle="Every client across your properties"
        actions={<button className="btn-primary" onClick={() => setForm(blankClient)}><IconPlus />Client</button>} />
      <Tabs value={status} onChange={setStatus} tabs={[['all', 'All'], ['active', 'In residence'], ['past', 'Not in a bed']]} />
      <div className="mb-4"><SearchInput value={q} onChange={setQ} placeholder="Search name, phone or ID number" /></div>
      {loading && !data ? <Spinner /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data.length ? (
        <Empty title="No clients found">Clients are added here or directly while assigning a bed.</Empty>
      ) : (
        <div className="card divide-y divide-slate-100">
          {data.map((c) => (
            <Link key={c.id} to={`/clients/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-bold text-brand-800">
                {c.full_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="truncate font-semibold">{c.full_name}</span>
                  {c.assignment_id ? <Badge color="green">Resident</Badge> : <Badge>Past</Badge>}</div>
                <div className="truncate text-xs text-slate-500">
                  {c.assignment_id ? `${bedPath(c)} · until ${fmtDate(c.current_period_end)}` : c.phone || 'No phone'}
                </div>
              </div>
              {Number(c.balance) > 0 && <span className="tabular text-sm font-semibold text-rose-600">{money(c.balance, user.currency)}</span>}
              <IconChevron className="h-4 w-4 text-slate-400" />
            </Link>
          ))}
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title="New client"
        footer={<><button className="btn-secondary flex-1" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn-primary flex-1" form="clientForm" disabled={busy}>Save</button></>}>
        {form && <form id="clientForm" onSubmit={create}><ClientFields f={form} setF={setForm} /></form>}
      </Modal>
    </>
  );
}
