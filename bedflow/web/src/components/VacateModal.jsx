import { useEffect, useMemo, useState } from 'react';
import { post } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Modal, Field, MoneyInput, useAction, Spinner } from './ui.jsx';
import { IconPlus, IconX } from './icons.jsx';
import { money, todayISO, fmtDate, methods } from '../lib/format.js';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const quickDeductions = ['Cleaning', 'Damages', 'Key / card loss', 'Notice period'];

export default function VacateModal({ open, onClose, onDone, tenancy }) {
  const { user } = useAuth();
  const cur = user.currency;
  const [run, busy] = useAction();
  const [date, setDate] = useState(todayISO());
  const [plan, setPlan] = useState(null);
  const [planErr, setPlanErr] = useState(null);
  const [mode, setMode] = useState('prorata');
  const [custom, setCustom] = useState('');
  const [deductions, setDeductions] = useState([]);
  const [applyDep, setApplyDep] = useState('');
  const [collect, setCollect] = useState('');
  const [method, setMethod] = useState('cash');
  const [refundMethod, setRefundMethod] = useState('cash');
  const [writeOff, setWriteOff] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setDate(todayISO()); setMode('prorata'); setCustom(''); setDeductions([]); setApplyDep(''); setCollect('');
    setWriteOff(false); setReason('');
  }, [open]);

  useEffect(() => {
    if (!open || !tenancy || !date) return;
    let live = true;
    setPlan(null); setPlanErr(null);
    post(`/assignments/${tenancy.id}/vacate/preview`, { vacate_date: date })
      .then((p) => live && setPlan(p))
      .catch((e) => live && setPlanErr(e.message));
    return () => { live = false; };
  }, [open, tenancy, date]);

  const calc = useMemo(() => {
    if (!plan) return null;
    const s = plan.settlement;
    const settlement = !s ? 0 : mode === 'prorata' ? s.prorata_due : mode === 'full' ? s.full_due : mode === 'custom' ? r2(custom) : 0;
    const dues = r2(plan.arrears_total + settlement);
    const ded = r2(deductions.reduce((t, d) => t + (Number(d.amount) || 0), 0));
    const available = r2(Math.max(0, plan.deposit_held - ded));
    const maxApply = Math.min(available, dues);
    const apply = applyDep === '' ? maxApply : Math.min(r2(applyDep), maxApply);
    const afterDep = r2(dues - apply);
    const coll = collect === '' ? afterDep : Math.min(r2(collect), afterDep);
    return {
      settlement, dues, ded, apply, coll,
      remaining: r2(afterDep - coll),
      refund: r2(plan.deposit_held - ded - apply),
      overDeducted: ded > plan.deposit_held,
    };
  }, [plan, mode, custom, deductions, applyDep, collect]);

  const submit = async () => {
    await run(() => post(`/assignments/${tenancy.id}/vacate`, {
      vacate_date: date,
      settlement_mode: mode,
      settlement_custom_amount: mode === 'custom' ? r2(custom) : undefined,
      collect_amount: calc.coll,
      collect_method: method,
      deposit_deductions: deductions.filter((d) => Number(d.amount) > 0).map((d) => ({ label: d.label || 'Deduction', amount: r2(d.amount) })),
      deposit_apply_to_dues: calc.apply,
      refund_method: refundMethod,
      write_off_remaining: writeOff && calc.remaining > 0,
      write_off_reason: reason || null,
    }), 'Client vacated');
    onDone?.();
  };

  const Row = ({ k, v, strong, tone }) => (
    <div className={`flex justify-between gap-3 py-1 text-sm ${strong ? 'font-semibold' : ''} ${tone || ''}`}><span>{k}</span><span className="tabular">{v}</span></div>
  );

  return (
    <Modal open={open} onClose={onClose} size="lg" title={`Vacate ${tenancy?.client_name || ''}`} subtitle={tenancy?.path}
      footer={<>
        <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className="btn-danger flex-[2]" disabled={busy || !calc || calc.overDeducted} onClick={submit}>
          {busy ? 'Processing…' : 'Confirm vacate'}
        </button>
      </>}>
      <div className="space-y-5">
        <Field label="Vacate date">
          <input className="input" type="date" min={tenancy?.start_date} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        {planErr && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{planErr}</p>}
        {!plan && !planErr && <Spinner />}

        {plan && calc && (
          <>
            <div className="rounded-2xl bg-slate-50 p-3 text-sm">
              <Row k="Rent paid through" v={plan.paid_through ? fmtDate(plan.paid_through) : 'Not paid'} />
              {plan.unused_prepaid && <Row k={`Unused prepaid days`} v={`${plan.unused_prepaid.unused_days} days (${money(plan.unused_prepaid.unused_value, cur)})`} tone="text-slate-500" />}
              {plan.future_periods_to_cancel > 0 && <Row k="Unbilled future periods cancelled" v={plan.future_periods_to_cancel} tone="text-slate-500" />}
              {plan.unpaid_deposit_to_cancel > 0 && <Row k="Uncollected deposit cancelled" v={money(plan.unpaid_deposit_to_cancel, cur)} tone="text-slate-500" />}
            </div>

            {/* Overstay settlement */}
            {plan.settlement && (
              <section>
                <h3 className="mb-1 text-sm font-semibold">Stay beyond paid period</h3>
                <p className="mb-2 text-xs text-slate-500">
                  {fmtDate(plan.settlement.period_start)} → {fmtDate(date)} · {plan.settlement.used_days} of {plan.settlement.period_days} days used
                  · period rent {money(plan.settlement.period_amount, cur)}
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[['prorata', 'Pro-rata', plan.settlement.prorata_due], ['full', 'Full period', plan.settlement.full_due],
                    ['custom', 'Custom', null], ['waive', 'Waive', 0]].map(([k, l, v]) => (
                    <button key={k} type="button" onClick={() => setMode(k)}
                      className={`rounded-xl border px-3 py-2 text-left ${mode === k ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}>
                      <div className="text-xs font-semibold text-slate-500">{l}</div>
                      <div className="tabular text-sm font-bold">{v === null ? '—' : money(v, cur)}</div>
                    </button>
                  ))}
                </div>
                {mode === 'custom' && (
                  <Field label="Custom amount" hint="Can be less than, equal to, or more than the due amount" className="mt-3">
                    <MoneyInput value={custom} onChange={setCustom} autoFocus />
                  </Field>
                )}
              </section>
            )}

            {plan.arrears.length > 0 && (
              <section>
                <h3 className="mb-1 text-sm font-semibold">Earlier outstanding dues</h3>
                <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                  {plan.arrears.map((a) => (
                    <div key={a.id} className="flex justify-between px-3 py-2 text-sm"><span className="truncate">{a.description}</span>
                      <span className="tabular font-semibold">{money(a.balance, cur)}</span></div>
                  ))}
                </div>
              </section>
            )}

            {/* Deposit */}
            <section className="rounded-2xl border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Security deposit</h3>
                <span className="tabular text-sm font-bold">{money(plan.deposit_held, cur)} held</span>
              </div>
              {plan.deposit_held > 0 && (
                <>
                  <p className="mt-1 text-xs text-slate-500">Deductions are converted to revenue. The rest is refunded.</p>
                  <div className="mt-2 space-y-2">
                    {deductions.map((d, i) => (
                      <div key={i} className="flex gap-2">
                        <input className="input flex-1" placeholder="Reason" value={d.label}
                          onChange={(e) => setDeductions(deductions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                        <div className="w-32"><MoneyInput value={d.amount} placeholder="0"
                          onChange={(v) => setDeductions(deductions.map((x, j) => (j === i ? { ...x, amount: v } : x)))} /></div>
                        <button type="button" className="btn-ghost min-h-[44px] px-2" onClick={() => setDeductions(deductions.filter((_, j) => j !== i))}><IconX className="h-4 w-4" /></button>
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {quickDeductions.map((q) => (
                      <button key={q} type="button" className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600"
                        onClick={() => setDeductions([...deductions, { label: q, amount: '' }])}><IconPlus className="mr-1 inline h-3 w-3" />{q}</button>
                    ))}
                  </div>
                  {calc.dues > 0 && (
                    <Field label="Use deposit to settle dues" hint={`Up to ${money(Math.min(Math.max(0, plan.deposit_held - calc.ded), calc.dues), cur)}`} className="mt-3">
                      <MoneyInput value={applyDep} placeholder={String(calc.apply)} onChange={setApplyDep} />
                    </Field>
                  )}
                  {calc.overDeducted && <p className="mt-2 text-xs font-semibold text-rose-600">Deductions exceed the deposit held.</p>}
                  {calc.refund > 0 && (
                    <Field label="Refund method" className="mt-3">
                      <select className="input" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
                        {methods.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </Field>
                  )}
                </>
              )}
            </section>

            {/* Collection after deposit */}
            {r2(calc.dues - calc.apply) > 0 && (
              <section className="space-y-3">
                <h3 className="text-sm font-semibold">Collect now</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Amount"><MoneyInput value={collect} placeholder={String(r2(calc.dues - calc.apply))} onChange={setCollect} /></Field>
                  <Field label="Method">
                    <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                      {methods.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </Field>
                </div>
              </section>
            )}

            {calc.remaining > 0 && (
              <section className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-amber-900">Write off remaining {money(calc.remaining, cur)}</span>
                  <input type="checkbox" className="h-5 w-5 accent-amber-600" checked={writeOff} onChange={(e) => setWriteOff(e.target.checked)} />
                </label>
                <p className="mt-1 text-xs text-amber-800">{writeOff ? 'The balance will be written off.' : 'Otherwise it stays in the receivables register.'}</p>
                {writeOff && <input className="input mt-2" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />}
              </section>
            )}

            {/* Summary */}
            <section className="rounded-2xl bg-slate-900 p-4 text-white">
              <Row k="Total dues" v={money(calc.dues, cur)} />
              {calc.apply > 0 && <Row k="Settled from deposit" v={`− ${money(calc.apply, cur)}`} />}
              {calc.coll > 0 && <Row k={`Collect now (${method.replace('_', ' ')})`} v={`− ${money(calc.coll, cur)}`} />}
              {calc.remaining > 0 && <Row k={writeOff ? 'Written off' : 'Left in receivables'} v={money(calc.remaining, cur)} />}
              <div className="my-2 border-t border-white/20" />
              {calc.ded > 0 && <Row k="Deposit retained as revenue" v={money(calc.ded, cur)} />}
              <Row strong k="Refund to client" v={money(calc.refund, cur)} />
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
