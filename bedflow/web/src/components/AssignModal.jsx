import { useEffect, useMemo, useState } from 'react';
import { get, post } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Modal, Field, MoneyInput, useAction } from './ui.jsx';
import { money, todayISO, periodEndISO, fmtDate, methods } from '../lib/format.js';

const units = [['day', 'Days'], ['week', 'Weeks'], ['month', 'Months']];

export default function AssignModal({ bed, open, onClose, onDone }) {
  const { user } = useAuth();
  const cur = user.currency;
  const [run, busy] = useAction();
  const [clients, setClients] = useState([]);
  const [mode, setMode] = useState('new');
  const [q, setQ] = useState('');
  const [f, setF] = useState(null);
  const [customExpiry, setCustomExpiry] = useState(false);

  useEffect(() => {
    if (!open || !bed) return;
    const start = todayISO();
    setF({
      client_id: '', full_name: '', phone: '', id_number: '', nationality: '',
      start_date: start, frequency_unit: 'month', frequency_count: 1,
      rent_amount: bed.default_rent ?? '', deposit_amount: '', expiry_date: periodEndISO(start, 'month', 1),
      prepaid: true, rent_collected: '', deposit_collected: '', payment_method: 'cash', notes: '',
    });
    setCustomExpiry(false); setMode('new'); setQ('');
    get('/clients', { status: 'past' }).then(setClients).catch(() => setClients([]));
  }, [open, bed]);

  // keep expiry in sync with start/frequency unless user set a custom one
  useEffect(() => {
    if (!f || customExpiry) return;
    const exp = periodEndISO(f.start_date, f.frequency_unit, Number(f.frequency_count) || 1);
    if (exp !== f.expiry_date) setF((x) => ({ ...x, expiry_date: exp }));
  }, [f?.start_date, f?.frequency_unit, f?.frequency_count, customExpiry]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => clients.filter((c) => `${c.full_name} ${c.phone || ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 30), [clients, q]);
  if (!f) return null;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const rent = customExpiry && f.first_period_amount !== '' && f.first_period_amount !== undefined
    ? Number(f.first_period_amount) || 0 : Number(f.rent_amount) || 0;
  const deposit = Number(f.deposit_amount) || 0;
  const rentPaid = f.prepaid ? (f.rent_collected === '' ? rent : Number(f.rent_collected)) : 0;
  const depPaid = f.prepaid ? (f.deposit_collected === '' ? deposit : Number(f.deposit_collected)) : 0;

  const submit = async (e) => {
    e.preventDefault();
    const body = {
      bed_id: bed.id, start_date: f.start_date, expiry_date: f.expiry_date,
      rent_amount: Number(f.rent_amount) || 0, first_period_amount: rent, frequency_unit: f.frequency_unit, frequency_count: Number(f.frequency_count) || 1,
      deposit_amount: deposit, rent_collected: rentPaid, deposit_collected: depPaid,
      payment_method: f.payment_method, notes: f.notes || null,
      ...(mode === 'existing' ? { client_id: f.client_id }
        : { new_client: { full_name: f.full_name, phone: f.phone || null, id_number: f.id_number || null, nationality: f.nationality || null } }),
    };
    await run(() => post('/assignments', body), 'Bed assigned');
    onDone?.();
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Assign ${bed?.label}`} subtitle={bed?.path}
      footer={<>
        <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex-[2]" form="assignForm" disabled={busy || (mode === 'existing' && !f.client_id)}>
          {busy ? 'Saving…' : `Assign${rentPaid + depPaid > 0 ? ` & collect ${money(rentPaid + depPaid, cur)}` : ''}`}
        </button>
      </>}>
      <form id="assignForm" onSubmit={submit} className="space-y-5">
        {/* Client */}
        <section>
          <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {[['new', 'New client'], ['existing', 'Existing client']].map(([k, l]) => (
              <button type="button" key={k} onClick={() => setMode(k)}
                className={`min-h-[40px] rounded-lg text-sm font-semibold ${mode === k ? 'bg-white shadow-sm' : 'text-slate-600'}`}>{l}</button>
            ))}
          </div>
          {mode === 'new' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Full name"><input className="input" required value={f.full_name} onChange={(e) => set('full_name', e.target.value)} /></Field>
              <Field label="Phone"><input className="input" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
              <Field label="ID / Passport no."><input className="input" value={f.id_number} onChange={(e) => set('id_number', e.target.value)} /></Field>
              <Field label="Nationality"><input className="input" value={f.nationality} onChange={(e) => set('nationality', e.target.value)} /></Field>
            </div>
          ) : (
            <div>
              <input className="input" placeholder="Search clients not currently in a bed…" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="mt-2 max-h-44 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                {filtered.map((c) => (
                  <button type="button" key={c.id} onClick={() => set('client_id', c.id)}
                    className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm ${f.client_id === c.id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                    <span className="font-medium">{c.full_name}</span><span className="text-xs text-slate-500">{c.phone}</span>
                  </button>
                ))}
                {!filtered.length && <p className="px-3 py-3 text-sm text-slate-500">No available clients. Add a new one.</p>}
              </div>
            </div>
          )}
        </section>

        {/* Terms */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">Rent terms</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date"><input className="input" type="date" required value={f.start_date} onChange={(e) => set('start_date', e.target.value)} /></Field>
            <Field label={`Rent per period (${cur})`}><MoneyInput required value={f.rent_amount} onChange={(v) => set('rent_amount', v)} /></Field>
          </div>
          <Field label="Rent frequency">
            <div className="flex gap-2">
              <input className="input w-20 text-center" type="number" min="1" max="365" value={f.frequency_count} onChange={(e) => set('frequency_count', e.target.value)} />
              <div className="grid flex-1 grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
                {units.map(([k, l]) => (
                  <button type="button" key={k} onClick={() => set('frequency_unit', k)}
                    className={`rounded-lg text-sm font-semibold ${f.frequency_unit === k ? 'bg-white shadow-sm' : 'text-slate-600'}`}>{l}</button>
                ))}
              </div>
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Expiry / next due" hint={customExpiry ? 'Custom date' : 'Auto from frequency'}>
              <input className="input" type="date" required min={f.start_date} value={f.expiry_date}
                onChange={(e) => { setCustomExpiry(true); set('expiry_date', e.target.value); }} />
            </Field>
            <Field label={`Security deposit (${cur})`}><MoneyInput value={f.deposit_amount} onChange={(v) => set('deposit_amount', v)} placeholder="0" /></Field>
          </div>
          {customExpiry && (
            <Field label={`First period amount (${cur})`} hint="Custom expiry — charge a different amount for this first period if needed">
              <MoneyInput value={f.first_period_amount ?? ''} placeholder={String(f.rent_amount || 0)} onChange={(v) => set('first_period_amount', v)} />
            </Field>
          )}
        </section>

        {/* Payment */}
        <section className="rounded-2xl border border-slate-200 p-3">
          <label className="flex items-center justify-between">
            <span className="text-sm font-semibold">Collected upfront (prepaid)</span>
            <input type="checkbox" className="h-5 w-5 accent-brand-700" checked={f.prepaid} onChange={(e) => set('prepaid', e.target.checked)} />
          </label>
          {f.prepaid && (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Rent received"><MoneyInput value={f.rent_collected} placeholder={String(rent)} onChange={(v) => set('rent_collected', v)} /></Field>
              <Field label="Deposit received"><MoneyInput value={f.deposit_collected} placeholder={String(deposit)} onChange={(v) => set('deposit_collected', v)} /></Field>
              <Field label="Method" className="col-span-2 sm:col-span-1">
                <select className="input" value={f.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
                  {methods.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            First period {fmtDate(f.start_date)} → {fmtDate(f.expiry_date)}.
            {rent - rentPaid > 0 && <> {money(rent - rentPaid, cur)} rent will go to receivables.</>}
            {deposit - depPaid > 0 && <> {money(deposit - depPaid, cur)} deposit pending.</>}
          </p>
        </section>

        <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </form>
    </Modal>
  );
}
