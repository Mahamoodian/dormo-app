import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../components/Toast.jsx';
import { IconKey } from '../../components/icons.jsx';

export function PasswordForm({ onDone, submitLabel = 'Update password' }) {
  const { changePassword } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const rules = [
    ['At least 8 characters', f.next.length >= 8],
    ['Contains letters and numbers', /[A-Za-z]/.test(f.next) && /\d/.test(f.next)],
    ['Passwords match', f.next && f.next === f.confirm],
  ];
  const submit = async (e) => {
    e.preventDefault();
    if (!rules.every(([, ok]) => ok)) return setError('Please meet all password requirements');
    setBusy(true); setError('');
    try {
      await changePassword(f.current, f.next);
      toast('Password updated');
      setF({ current: '', next: '', confirm: '' });
      onDone?.();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <div><label className="label">Current / temporary password</label>
        <input className="input" type="password" autoComplete="current-password" required value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></div>
      <div><label className="label">New password</label>
        <input className="input" type="password" autoComplete="new-password" required value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></div>
      <div><label className="label">Confirm new password</label>
        <input className="input" type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></div>
      <ul className="space-y-1 text-xs">
        {rules.map(([t, ok]) => <li key={t} className={ok ? 'text-emerald-700' : 'text-slate-500'}>{ok ? '✓' : '○'} {t}</li>)}
      </ul>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
    </form>
  );
}

export default function ChangePassword() {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-amber-100 text-amber-700"><IconKey /></div>
          <h1 className="mt-3 text-xl font-bold">Set your own password</h1>
          <p className="mt-1 text-sm text-slate-500">
            Hi {user?.full_name?.split(' ')[0]}, you signed in with a temporary password. Choose a new one to continue.
          </p>
        </div>
        <div className="card p-6"><PasswordForm submitLabel="Save & continue" /></div>
        <button onClick={logout} className="btn-ghost mx-auto mt-4 flex">Sign out</button>
      </div>
    </div>
  );
}
