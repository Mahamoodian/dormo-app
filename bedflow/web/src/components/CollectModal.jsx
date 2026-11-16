import { useEffect, useState } from 'react';
import { post } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Modal, Field, useAction } from './ui.jsx';
import { money, todayISO, methods } from '../lib/format.js';

/**
 * Collect against a single receivable (target.receivableId) or a whole tenancy (target.assignmentId).
 * Amount below balance leaves the remainder open; above balance pre-pays future periods.
 */
export default function CollectModal({ open, onClose, onDone, target }) {
  const { user } = useAuth();
  const [run, busy] = useAction();
  const [f, setF] = useState({ amount: '', method: 'cash', paid_on: todayISO(), note: '' });

  useEffect(() => {
    if (open) setF({ amount: target?.balance ? String(target.balance) : '', method: 'cash', paid_on: todayISO(), note: '' });
  }, [open, target]);

  const submit = async (e) => {
    e.preventDefault();
    const body = { amount: Number(f.amount), method: f.method, paid_on: f.paid_on, note: f.note || null };
    const path = target.receivableId ? `/receivables/${target.receivableId}/collect` : `/assignments/${target.assignmentId}/collect`;
    await run(() => post(path, body), `Collected ${money(body.amount, user.currency)}`);
    onDone?.();
  };
  const amt = Number(f.amount) || 0;
  const bal = Number(target?.balance) || 0;

  return (
    <Modal open={open} onClose={onClose} size="sm" title="Collect payment" subtitle={target?.title}
      footer={<>
        <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex-[2]" form="collectForm" disabled={busy || amt <= 0}>Enter {amt > 0 ? money(amt, user.currency) : ''}</button>
      </>}>
      <form id="collectForm" onSubmit={submit} className="space-y-4">
        {target?.subtitle && <p className="text-sm text-slate-500">{target.subtitle}</p>}
        <Field label={`Amount (${user.currency})`}>
          <input className="input tabular h-14 text-2xl font-bold" type="number" inputMode="decimal" step="0.01" min="0.01" autoFocus required
            value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </Field>
        {bal > 0 && amt > 0 && (
          <p className={`rounded-lg px-3 py-2 text-xs ${amt < bal ? 'bg-amber-50 text-amber-800' : amt > bal ? 'bg-sky-50 text-sky-800' : 'bg-emerald-50 text-emerald-800'}`}>
            {amt < bal ? `Partial payment — ${money(bal - amt, user.currency)} stays in receivables.`
              : amt > bal ? `${money(amt - bal, user.currency)} extra will be applied to other dues / next period in advance.`
                : 'Settles the balance in full.'}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Method">
            <select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              {methods.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Date"><input className="input" type="date" max={todayISO()} value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} /></Field>
        </div>
        <Field label="Note"><input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Optional (receipt no., etc.)" /></Field>
      </form>
    </Modal>
  );
}
