import { useCallback, useEffect, useRef, useState } from 'react';
import { IconX, IconSearch } from './icons.jsx';
import { useToast } from './Toast.jsx';

/** Load data with loading / error state and a reload function. */
export function useLoad(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fnRef.current());
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Wraps an async action with busy state and error toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn, successMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (successMsg) toast(successMsg);
      return r;
    } catch (e) {
      toast(e.message || 'Something went wrong', 'error');
      throw e;
    } finally {
      setBusy(false);
    }
  };
  return [run, busy];
}

/** Responsive modal: bottom sheet on phones, centered dialog on larger screens. */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]" onClick={onClose} />
      <div className={`relative flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-xl sm:rounded-2xl ${widths[size]}`}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-200 sm:hidden" />
            <h2 className="truncate text-lg font-semibold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost -mr-2 min-h-0 p-2" aria-label="Close"><IconX /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex gap-2 border-t border-slate-100 px-5 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

const badgeColors = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  slate: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
};
export const Badge = ({ color = 'slate', children }) => (
  <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${badgeColors[color]}`}>{children}</span>
);

export function Stat({ label, value, sub, tone = 'default', icon }) {
  const tones = { default: 'text-slate-900', good: 'text-emerald-700', bad: 'text-rose-600', warn: 'text-amber-700' };
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}{icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <div className={`tabular mt-1.5 text-2xl font-bold ${tones[tone]}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export const Spinner = ({ className = '' }) => (
  <div className={`flex justify-center py-10 ${className}`}>
    <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-brand-200 border-t-brand-700" />
  </div>
);

export const Empty = ({ title, children, action }) => (
  <div className="card flex flex-col items-center px-6 py-10 text-center">
    <p className="font-semibold text-slate-700">{title}</p>
    {children && <p className="mt-1 max-w-sm text-sm text-slate-500">{children}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const ErrorBox = ({ error, onRetry }) => (
  <div className="card border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
    {error?.message || 'Failed to load'}{' '}
    {onRetry && <button className="font-semibold underline" onClick={onRetry}>Retry</button>}
  </div>
);

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="relative">
      <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input className="input pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} type="search" />
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div className="inline-flex gap-1 rounded-xl bg-slate-200/70 p-1">
        {tabs.map(([key, label, count]) => (
          <button key={key} onClick={() => onChange(key)}
            className={`min-h-[38px] whitespace-nowrap rounded-lg px-3 text-sm font-semibold transition ${
              value === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
            {label}{count !== undefined && count !== null && <span className="ml-1.5 text-xs text-slate-500">{count}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', danger, busy }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<>
        <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button className={`${danger ? 'btn-danger' : 'btn-primary'} flex-1`} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
      </>}>
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  );
}

/** Numeric money input that keeps the raw string while typing. */
export function MoneyInput({ value, onChange, ...p }) {
  return (
    <input className="input tabular" type="number" inputMode="decimal" step="0.01" min="0"
      value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...p} />
  );
}
