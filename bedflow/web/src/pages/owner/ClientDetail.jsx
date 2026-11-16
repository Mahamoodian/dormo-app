import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, patch, del } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLoad, useAction, Spinner, ErrorBox, PageHeader, Badge, Modal, Field, Tabs, ConfirmModal } from '../../components/ui.jsx';
import CollectModal from '../../components/CollectModal.jsx';
import VacateModal from '../../components/VacateModal.jsx';
import { IconPhone, IconEdit } from '../../components/icons.jsx';
import { money, fmtDate, bedPath, freqLabel } from '../../lib/format.js';

export const blankClient = { full_name: '', phone: '', email: '', id_type: '', id_number: '', nationality: '', emergency_contact: '', notes: '' };

export function ClientFields({ f, setF }) {
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Full name" className="sm:col-span-2"><input className="input" required value={f.full_name || ''} onChange={s('full_name')} /></Field>
      <Field label="Phone"><input className="input" type="tel" value={f.phone || ''} onChange={s('phone')} /></Field>
      <Field label="Email"><input className="input" type="email" value={f.email || ''} onChange={s('email')} /></Field>
      <Field label="ID type"><input className="input" value={f.id_type || ''} onChange={s('id_type')} placeholder="Passport / Emirates ID / Aadhaar" /></Field>
      <Field label="ID number"><input className="input" value={f.id_number || ''} onChange={s('id_number')} /></Field>
      <Field label="Nationality"><input className="input" value={f.nationality || ''} onChange={s('nationality')} /></Field>
      <Field label="Emergency contact"><input className="input" value={f.emergency_contact || ''} onChange={s('emergency_contact')} /></Field>
      <Field label="Notes" className="sm:col-span-2"><textarea className="input" rows={2} value={f.notes || ''} onChange={s('notes')} /></Field>
    </div>
  );
}

const ledgerLabel = { collected: 'Received', refunded: 'Refunded', converted_to_revenue: 'Retained (revenue)', applied_to_dues: 'Applied to dues' };

export default function ClientDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const cur = user.currency;
  const { data, error, loading, reload } = useLoad(() => get(`/clients/${id}`), [id]);
  const [run, busy] = useAction();
  const [edit, setEdit] = useState(null);
  const [tab, setTab] = useState('dues');
  const [collect, setCollect] = useState(null);
  const [vacate, setVacate] = useState(null);
  const [delPay, setDelPay] = useState(null);
  const [delClient, setDelClient] = useState(false);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { client: c, assignments, receivables, payments, deposit_ledger: dl } = data;
  const active = assignments.find((a) => a.status === 'active');
  const open = receivables.filter((r) => r.status === 'open');
  const owed = open.reduce((s, r) => s + Number(r.balance), 0);

  const save = async (e) => {
    e.preventDefault();
    const { id: _id, owner_id, created_at, ...body } = edit; // eslint-disable-line no-unused-vars
    await run(() => patch(`/clients/${id}`, body), 'Client updated');
    setEdit(null);
    reload();
  };

  return (
    <>
      <Link to="/clients" className="text-sm font-semibold text-brand-700">← Clients</Link>
      <PageHeader title={c.full_name}
        subtitle={[c.phone, c.nationality, c.id_number && `${c.id_type || 'ID'} ${c.id_number}`].filter(Boolean).join(' · ') || 'No contact details'}
        actions={<>
          {c.phone && <a href={`tel:${c.phone}`} className="btn-secondary"><IconPhone className="h-4 w-4" />Call</a>}
          <button className="btn-secondary" onClick={() => setEdit({ ...c })}><IconEdit className="h-4 w-4" />Edit</button>
        </>} />

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2">
          {active ? (
            <>
              <div className="flex items-center justify-between"><h2 className="font-semibold">Current bed</h2><Badge color="green">Resident</Badge></div>
              <p className="mt-1 text-sm text-slate-600">{bedPath(active)}</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><div className="text-xs text-slate-500">Rent</div><div className="tabular font-semibold">{money(active.rent_amount, cur)}</div>
                  <div className="text-xs text-slate-500">{freqLabel(active.frequency_unit, active.frequency_count)}</div></div>
                <div><div className="text-xs text-slate-500">Since</div><div className="font-semibold">{fmtDate(active.start_date)}</div></div>
                <div><div className="text-xs text-slate-500">Paid period ends</div><div className="font-semibold">{fmtDate(active.current_period_end)}</div></div>
                <div><div className="text-xs text-slate-500">Deposit</div><div className="tabular font-semibold">{money(active.deposit_amount, cur)}</div></div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:flex">
                <button className="btn-primary" onClick={() => setCollect({ assignmentId: active.id, balance: owed || Number(active.rent_amount), title: c.full_name,
                  subtitle: owed ? 'Pays oldest dues first' : 'No dues — pre-pays the next period' })}>Collect</button>
                <button className="btn-secondary text-rose-600" onClick={() => setVacate({ id: active.id, client_name: c.full_name, start_date: active.start_date, path: bedPath(active) })}>Vacate</button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div><h2 className="font-semibold">Not currently in a bed</h2><p className="text-sm text-slate-500">Assign from the Beds board.</p></div>
              <Link to="/beds?filter=available" className="btn-primary">Assign bed</Link>
            </div>
          )}
        </div>
        <div className="card p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Outstanding</div>
          <div className={`tabular mt-1 text-3xl font-bold ${owed > 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{money(owed, cur)}</div>
          <div className="mt-1 text-xs text-slate-500">{open.length} open item(s) · {payments.length} payment(s)</div>
          {c.emergency_contact && <div className="mt-3 text-xs text-slate-500">Emergency: {c.emergency_contact}</div>}
          {c.notes && <div className="mt-2 whitespace-pre-wrap text-xs text-slate-500">{c.notes}</div>}
        </div>
      </div>

      <div className="mt-6">
        <Tabs value={tab} onChange={setTab} tabs={[['dues', 'Dues', open.length], ['payments', 'Payments', payments.length], ['deposit', 'Deposit'], ['history', 'Tenancies', assignments.length]]} />
        <div className="card divide-y divide-slate-100">
          {tab === 'dues' && receivables.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0"><div className="truncate font-medium">{r.description}</div>
                <div className="text-xs text-slate-500">Due {fmtDate(r.due_date)} · paid {money(r.amount_paid, cur)}{Number(r.amount_written_off) ? ` · w/o ${money(r.amount_written_off, cur)}` : ''}</div></div>
              <div className="text-right">
                <div className="tabular font-semibold">{money(r.status === 'open' ? r.balance : r.amount_due, cur)}</div>
                <Badge color={{ open: r.due_date <= data.today ? 'red' : 'amber', paid: 'green', written_off: 'amber', void: 'slate' }[r.status]}>
                  {r.status === 'open' ? (r.due_date <= data.today ? 'Overdue' : 'Open') : r.status.replace('_', ' ')}</Badge>
              </div>
            </div>
          ))}
          {tab === 'payments' && payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div><div className="font-medium">{fmtDate(p.paid_on)} · {p.method.replace('_', ' ')}</div>{p.note && <div className="text-xs text-slate-500">{p.note}</div>}</div>
              <div className="flex items-center gap-2"><span className="tabular font-semibold">{money(p.amount, cur)}</span>
                {p.method !== 'deposit_adjustment' && <button className="text-xs font-semibold text-rose-600" onClick={() => setDelPay(p)}>Reverse</button>}</div>
            </div>
          ))}
          {tab === 'deposit' && dl.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div><div className="font-medium">{ledgerLabel[d.entry_type]}</div><div className="text-xs text-slate-500">{fmtDate(d.entry_date)}{d.reason ? ` · ${d.reason}` : ''}</div></div>
              <span className={`tabular font-semibold ${d.entry_type === 'collected' ? 'text-emerald-700' : ''}`}>{d.entry_type === 'collected' ? '+' : '−'}{money(d.amount, cur)}</span>
            </div>
          ))}
          {tab === 'history' && assignments.map((a) => (
            <div key={a.id} className="px-4 py-3 text-sm">
              <div className="flex items-center justify-between"><span className="font-medium">{bedPath(a)}</span>
                <Badge color={a.status === 'active' ? 'green' : 'slate'}>{a.status}</Badge></div>
              <div className="text-xs text-slate-500">{fmtDate(a.start_date)} → {a.vacate_date ? fmtDate(a.vacate_date) : 'present'} · {money(a.rent_amount, cur)} {freqLabel(a.frequency_unit, a.frequency_count)}</div>
              {a.vacate_summary && <div className="mt-1 text-xs text-slate-500">Refunded {money(a.vacate_summary.deposit_refunded, cur)} · retained {money(a.vacate_summary.deposit_deductions?.reduce((s, x) => s + Number(x.amount), 0) || 0, cur)} · written off {money(a.vacate_summary.written_off, cur)}</div>}
            </div>
          ))}
          {((tab === 'dues' && !receivables.length) || (tab === 'payments' && !payments.length) || (tab === 'deposit' && !dl.length) || (tab === 'history' && !assignments.length)) &&
            <p className="px-4 py-6 text-center text-sm text-slate-500">Nothing here yet.</p>}
        </div>
        {!assignments.length && <button className="btn-ghost mt-4 text-rose-600" onClick={() => setDelClient(true)}>Delete client</button>}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title="Edit client"
        footer={<><button className="btn-secondary flex-1" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary flex-1" form="editClient" disabled={busy}>Save</button></>}>
        {edit && <form id="editClient" onSubmit={save}><ClientFields f={edit} setF={setEdit} /></form>}
      </Modal>
      <CollectModal open={!!collect} target={collect} onClose={() => setCollect(null)} onDone={() => { setCollect(null); reload(); }} />
      <VacateModal open={!!vacate} tenancy={vacate} onClose={() => setVacate(null)} onDone={() => { setVacate(null); reload(); }} />
      <ConfirmModal open={!!delPay} onClose={() => setDelPay(null)} busy={busy} danger confirmLabel="Reverse payment" title="Reverse payment?"
        message={`The ${money(delPay?.amount, cur)} payment from ${fmtDate(delPay?.paid_on)} will be removed and the balance reopened.`}
        onConfirm={async () => { await run(() => del(`/payments/${delPay.id}`), 'Payment reversed'); setDelPay(null); reload(); }} />
      <ConfirmModal open={delClient} onClose={() => setDelClient(false)} busy={busy} danger confirmLabel="Delete" title="Delete client?"
        message="This client has no tenancy history and will be permanently removed."
        onConfirm={async () => { await run(() => del(`/clients/${id}`), 'Client deleted'); nav('/clients'); }} />
    </>
  );
}
