import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useLoad, useAction, Spinner, ErrorBox, PageHeader, Tabs, Empty, Badge, SearchInput, Modal, Field, MoneyInput, Stat } from '../../components/ui.jsx';
import CollectModal from '../../components/CollectModal.jsx';
import { money, fmtDate, bedPath, freqLabel } from '../../lib/format.js';
import { IconPhone } from '../../components/icons.jsx';

const kindLabel = { rent: 'Rent', deposit: 'Deposit', settlement: 'Settlement' };

export default function Receivables() {
  const { user } = useAuth();
  const cur = user.currency;
  const [tab, setTab] = useState('due');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  const list = useLoad(() => get('/receivables', { tab, q: dq }), [tab, dq]);
  const summary = useLoad(() => get('/receivables/summary'), []);
  const [collect, setCollect] = useState(null);
  const [wo, setWo] = useState(null);

  const refresh = () => { list.reload(); summary.reload(); };
  const s = summary.data;

  return (
    <>
      <PageHeader title="Receivables" subtitle="Collect rent, track balances and write off bad debt" />
      {s && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Due now" value={money(s.overdue_total, cur)} sub={`${s.overdue_count} item(s)`} tone={Number(s.overdue_total) ? 'bad' : 'default'} />
          <Stat label="All open" value={money(s.open_total, cur)} sub={`${s.open_count} item(s)`} />
        </div>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[
        ['due', 'Due & overdue', s?.overdue_count], ['upcoming', 'Expiring soon', s?.upcoming_count], ['open', 'All open', s?.open_count], ['closed', 'History'],
      ]} />
      <div className="mb-4"><SearchInput value={q} onChange={setQ} placeholder="Search client, phone, bed or flat" /></div>

      {list.loading && !list.data ? <Spinner /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : (
        tab === 'upcoming'
          ? <UpcomingList rows={list.data.rows} cur={cur} onCollect={setCollect} />
          : !list.data.rows.length
            ? <Empty title={tab === 'due' ? 'Nothing due — all caught up 🎉' : 'No records'} />
            : <div className="space-y-2.5">
                {list.data.rows.map((r) => (
                  <ReceivableRow key={r.id} r={r} cur={cur} today={list.data.today} closed={tab === 'closed'} onDone={refresh}
                    onMore={() => setCollect({ receivableId: r.id, balance: Number(r.balance), title: r.client_name, subtitle: r.description })}
                    onWriteOff={() => setWo(r)} />
                ))}
              </div>
      )}

      <CollectModal open={!!collect} target={collect} onClose={() => setCollect(null)} onDone={() => { setCollect(null); refresh(); }} />
      <WriteOffModal r={wo} cur={cur} onClose={() => setWo(null)} onDone={() => { setWo(null); refresh(); }} />
    </>
  );
}

function ReceivableRow({ r, cur, today, closed, onDone, onMore, onWriteOff }) {
  const [amount, setAmount] = useState('');
  const [run, busy] = useAction();
  const overdue = r.status === 'open' && r.days_overdue > 0;
  const enter = async (e) => {
    e.preventDefault();
    const amt = Number(amount || r.balance);
    if (!(amt > 0)) return;
    await run(() => post(`/receivables/${r.id}/collect`, { amount: amt, method: 'cash' }), `Collected ${money(amt, cur)} from ${r.client_name}`);
    setAmount('');
    onDone();
  };
  return (
    <div className={`card p-3.5 ${overdue ? 'border-rose-200' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Link to={`/clients/${r.client_id}`} className="font-semibold hover:underline">{r.client_name}</Link>
            <Badge color={r.kind === 'deposit' ? 'blue' : 'slate'}>{kindLabel[r.kind]}</Badge>
            {r.assignment_status === 'vacated' && <Badge color="amber">Vacated</Badge>}
            {overdue && <Badge color="red">Overdue {r.days_overdue}d</Badge>}
            {r.status === 'open' && r.days_overdue === 0 && r.due_date === today && <Badge color="amber">Due today</Badge>}
            {closed && <Badge color={r.status === 'paid' ? 'green' : 'amber'}>{r.status === 'paid' ? 'Paid' : 'Written off'}</Badge>}
          </div>
          <div className="mt-0.5 truncate text-xs text-slate-500">{bedPath(r)}</div>
          <div className="mt-0.5 text-xs text-slate-500">{r.description} · due {fmtDate(r.due_date)}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className={`tabular text-lg font-bold ${overdue ? 'text-rose-600' : ''}`}>{money(closed ? r.amount_due : r.balance, cur)}</div>
          {!closed && Number(r.amount_paid) > 0 && <div className="tabular text-xs text-slate-500">paid {money(r.amount_paid, cur)} of {money(r.amount_due, cur)}</div>}
          {closed && Number(r.amount_written_off) > 0 && <div className="tabular text-xs text-amber-700">w/o {money(r.amount_written_off, cur)}</div>}
        </div>
      </div>
      {!closed && (
        <form onSubmit={enter} className="mt-3 flex gap-2">
          <div className="flex-1"><MoneyInput value={amount} onChange={setAmount} placeholder={`${Number(r.balance)}`} aria-label="Amount collected" /></div>
          <button className="btn-primary px-5" disabled={busy}>Enter</button>
          <button type="button" className="btn-secondary px-3" onClick={onMore} title="Method, date, note">⋯</button>
          <button type="button" className="btn-secondary px-3 text-amber-700" onClick={onWriteOff}>W/O</button>
          {r.client_phone && <a href={`tel:${r.client_phone}`} className="btn-secondary hidden px-3 sm:inline-flex" aria-label="Call"><IconPhone className="h-4 w-4" /></a>}
        </form>
      )}
    </div>
  );
}

function UpcomingList({ rows, cur, onCollect }) {
  if (!rows.length) return <Empty title="No tenancies expiring in the next 7 days" />;
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.assignment_id} className="card flex items-center justify-between gap-3 p-3.5">
          <div className="min-w-0">
            <div className="font-semibold">{r.client_name}</div>
            <div className="truncate text-xs text-slate-500">{bedPath(r)}</div>
            <div className="mt-0.5 text-xs text-slate-500">Paid until {fmtDate(r.current_period_end)} ·
              <span className={r.days_left <= 1 ? ' font-semibold text-amber-700' : ''}> {r.days_left === 0 ? 'expires today' : `${r.days_left} day(s) left`}</span></div>
          </div>
          <div className="shrink-0 text-right">
            <div className="tabular font-bold">{money(r.rent_amount, cur)}</div>
            <div className="text-xs text-slate-500">{freqLabel(r.frequency_unit, r.frequency_count)}</div>
            <button className="btn-primary mt-1.5 min-h-[36px] px-3 text-xs"
              onClick={() => onCollect({ assignmentId: r.assignment_id, balance: Number(r.rent_amount), title: r.client_name, subtitle: `Advance payment for the period starting ${fmtDate(r.next_due)}` })}>
              Collect early
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function WriteOffModal({ r, cur, onClose, onDone }) {
  const [run, busy] = useAction();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { if (r) { setAmount(String(r.balance)); setReason(''); } }, [r]);
  if (!r) return null;
  const submit = async (e) => {
    e.preventDefault();
    await run(() => post(`/receivables/${r.id}/write-off`, { amount: Number(amount), reason: reason || null }), 'Written off');
    onDone();
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Write off balance" subtitle={`${r.client_name} · ${r.description}`}
      footer={<><button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className="btn-danger flex-1" form="woForm" disabled={busy}>Write off</button></>}>
      <form id="woForm" onSubmit={submit} className="space-y-4">
        <Field label={`Amount (${cur})`} hint={`Outstanding: ${money(r.balance, cur)}`}>
          <MoneyInput value={amount} onChange={setAmount} max={r.balance} required />
        </Field>
        <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client absconded" /></Field>
      </form>
    </Modal>
  );
}
