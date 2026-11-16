import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, post, patch, del } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLoad, useAction, Spinner, ErrorBox, PageHeader, Empty, Modal, Field, MoneyInput, ConfirmModal, Badge } from '../../components/ui.jsx';
import { IconPlus, IconTrash } from '../../components/icons.jsx';
import { money, fmtDate, todayISO } from '../../lib/format.js';

export default function Expenses() {
  const { user } = useAuth();
  const cur = user.currency;
  const [params, setParams] = useSearchParams();
  const [month, setMonth] = useState(todayISO().slice(0, 7));
  const [flatId, setFlatId] = useState('');
  const [catId, setCatId] = useState('');
  const list = useLoad(() => get('/expenses', { month, flat_id: flatId, category_id: catId }), [month, flatId, catId]);
  const meta = useLoad(() => Promise.all([get('/properties/flats'), get('/expenses/categories')]), []);
  const [form, setForm] = useState(null);
  const [catModal, setCatModal] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [run, busy] = useAction();
  const [flats, cats] = meta.data || [[], []];

  const openNew = () => setForm({ flat_id: flatId || flats[0]?.id || '', category_id: cats[0]?.id || '', amount: '', expense_date: todayISO(), description: '', vendor: '', payment_method: 'cash' });
  useEffect(() => {
    if (params.get('new') && meta.data) { openNew(); setParams({}, { replace: true }); }
  }, [meta.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (e) => {
    e.preventDefault();
    const body = { ...form, amount: Number(form.amount) };
    delete body.id;
    await run(() => (form.id ? patch(`/expenses/${form.id}`, body) : post('/expenses', body)), 'Expense saved');
    setForm(null);
    list.reload();
  };

  const byCat = useMemo(() => {
    const m = {};
    (list.data?.rows || []).forEach((e) => { m[e.category_name] = (m[e.category_name] || 0) + Number(e.amount); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [list.data]);

  if (meta.loading && !meta.data) return <Spinner />;
  if (meta.error) return <ErrorBox error={meta.error} onRetry={meta.reload} />;

  return (
    <>
      <PageHeader title="Expenses" subtitle="Recorded per flat / dormitory"
        actions={<>
          <button className="btn-secondary" onClick={() => setCatModal(true)}>Categories</button>
          <button className="btn-primary" disabled={!flats.length} onClick={openNew}><IconPlus />Expense</button>
        </>} />
      {!flats.length && <Empty title="Add a flat or dormitory first">Expenses are tracked flat-wise.</Empty>}

      {!!flats.length && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />
            <select className="input" value={flatId} onChange={(e) => setFlatId(e.target.value)}>
              <option value="">All flats</option>
              {flats.map((f) => <option key={f.id} value={f.id}>{f.building_name} › {f.name}</option>)}
            </select>
            <select className="input col-span-2 sm:col-span-1" value={catId} onChange={(e) => setCatId(e.target.value)}>
              <option value="">All categories</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {list.loading && !list.data ? <Spinner /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="card p-4 lg:order-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total</div>
                <div className="tabular mt-1 text-2xl font-bold">{money(list.data.total, cur)}</div>
                <div className="mt-3 space-y-2">
                  {byCat.map(([k, v]) => (
                    <div key={k}>
                      <div className="flex justify-between text-sm"><span>{k}</span><span className="tabular font-medium">{money(v, cur)}</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-brand-500" style={{ width: `${(v / list.data.total) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="lg:order-1 lg:col-span-2">
                {!list.data.rows.length ? <Empty title="No expenses for this filter" /> : (
                  <div className="card divide-y divide-slate-100">
                    {list.data.rows.map((e) => (
                      <button key={e.id} onClick={() => setForm({ ...e })} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2"><span className="truncate font-medium">{e.description || e.category_name}</span><Badge>{e.category_name}</Badge></div>
                          <div className="truncate text-xs text-slate-500">{fmtDate(e.expense_date)} · {e.building_name} › {e.flat_name}{e.vendor ? ` · ${e.vendor}` : ''}</div>
                        </div>
                        <span className="tabular shrink-0 font-semibold">{money(e.amount, cur)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit expense' : 'New expense'}
        footer={<>
          {form?.id && <button className="btn-ghost text-rose-600" onClick={() => { setConfirm(form); setForm(null); }}><IconTrash className="h-4 w-4" /></button>}
          <button className="btn-secondary flex-1" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn-primary flex-1" form="expForm" disabled={busy}>Save</button>
        </>}>
        {form && (
          <form id="expForm" onSubmit={save} className="space-y-4">
            <Field label={`Amount (${cur})`}>
              <input className="input tabular h-14 text-2xl font-bold" type="number" inputMode="decimal" step="0.01" min="0.01" required autoFocus
                value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Category">
              <div className="flex flex-wrap gap-1.5">
                {cats.map((c) => (
                  <button type="button" key={c.id} onClick={() => setForm({ ...form, category_id: c.id })}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${form.category_id === c.id ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-slate-300 text-slate-600'}`}>{c.name}</button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Flat / dormitory" className="col-span-2 sm:col-span-1">
                <select className="input" required value={form.flat_id} onChange={(e) => setForm({ ...form, flat_id: e.target.value })}>
                  {flats.map((f) => <option key={f.id} value={f.id}>{f.building_name} › {f.name}</option>)}
                </select>
              </Field>
              <Field label="Date" className="col-span-2 sm:col-span-1"><input className="input" type="date" required value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} /></Field>
            </div>
            <Field label="Description"><input className="input" value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. DEWA bill October" /></Field>
            <Field label="Vendor"><input className="input" value={form.vendor || ''} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="Optional" /></Field>
          </form>
        )}
      </Modal>

      <CategoriesModal open={catModal} cats={cats} onClose={() => setCatModal(false)} onChange={meta.reload} />
      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} busy={busy} danger confirmLabel="Delete" title="Delete expense?"
        message={`${money(confirm?.amount, cur)} · ${confirm?.category_name}`}
        onConfirm={async () => { await run(() => del(`/expenses/${confirm.id}`), 'Deleted'); setConfirm(null); list.reload(); }} />
    </>
  );
}

function CategoriesModal({ open, cats, onClose, onChange }) {
  const [name, setName] = useState('');
  const [run, busy] = useAction();
  const add = async (e) => {
    e.preventDefault();
    await run(() => post('/expenses/categories', { name }), 'Category added');
    setName('');
    onChange();
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Expense categories" subtitle="Built-in categories plus your own">
      <form onSubmit={add} className="mb-4 flex gap-2">
        <input className="input flex-1" required placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-primary" disabled={busy}>Add</button>
      </form>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {cats.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>{c.name}</span>
            {c.is_system ? <Badge>Built-in</Badge> : (
              <button className="text-xs font-semibold text-rose-600" onClick={async () => { await run(() => del(`/expenses/categories/${c.id}`), 'Removed'); onChange(); }}>Remove</button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
