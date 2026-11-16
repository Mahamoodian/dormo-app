import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post, patch } from '../../api/client.js';
import { useLoad, useAction, Spinner, ErrorBox, PageHeader, Modal, Field, ConfirmModal, Empty, SearchInput } from '../../components/ui.jsx';
import { IconPlus, IconEye, IconKey } from '../../components/icons.jsx';
import { useToast } from '../../components/Toast.jsx';
import { fmtDateTime } from '../../lib/format.js';
import { StatusBadge } from './AdminReports.jsx';

const blank = { full_name: '', business_name: '', email: '', phone: '', currency: 'AED' };

export default function AdminUsers() {
  const { data, error, loading, reload } = useLoad(() => get('/admin/users'));
  const [run, busy] = useAction();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [cred, setCred] = useState(null); // { email, temp_password, title }
  const [confirm, setConfirm] = useState(null);
  const [q, setQ] = useState('');

  const create = async (e) => {
    e.preventDefault();
    const r = await run(() => post('/admin/users', form), 'User created');
    setForm(null);
    setCred({ title: 'User created', email: r.user.email, temp_password: r.temp_password });
    reload();
  };
  const doConfirm = async () => {
    const { type, user } = confirm;
    if (type === 'reset') {
      const r = await run(() => post(`/admin/users/${user.id}/reset-password`), 'Password reset');
      setCred({ title: 'Password reset', email: user.email, temp_password: r.temp_password });
    } else {
      await run(() => patch(`/admin/users/${user.id}/status`, { is_active: !user.is_active }), user.is_active ? 'User disabled' : 'User enabled');
    }
    setConfirm(null);
    reload();
  };

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const users = data.users.filter((u) => `${u.full_name} ${u.business_name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="Users" subtitle="Business owners on the platform"
        actions={<button className="btn-primary" onClick={() => setForm(blank)}><IconPlus />New user</button>} />
      <div className="mb-4 max-w-md"><SearchInput value={q} onChange={setQ} placeholder="Search name, business or email" /></div>
      {!users.length ? <Empty title="No users found">Create a business owner account to get started.</Empty> : (
        <div className="space-y-3">
          {users.map((u) => (
            <div key={u.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{u.business_name || u.full_name}</span><StatusBadge u={u} />
                </div>
                <div className="text-sm text-slate-500">{u.full_name} · {u.email}{u.phone ? ` · ${u.phone}` : ''}</div>
                <div className="mt-1 text-xs text-slate-400">Created {fmtDateTime(u.created_at)} · Last login {fmtDateTime(u.last_login_at)}</div>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:flex">
                <Link to={`/admin/users/${u.id}`} className="btn-secondary px-3"><IconEye className="h-4 w-4" />View</Link>
                <button className="btn-secondary px-3" onClick={() => setConfirm({ type: 'reset', user: u })}><IconKey className="h-4 w-4" />Reset</button>
                <button className={u.is_active ? 'btn-secondary px-3 text-rose-600' : 'btn-primary px-3'}
                  onClick={() => setConfirm({ type: 'toggle', user: u })}>{u.is_active ? 'Disable' : 'Enable'}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title="Create business user"
        subtitle="A temporary password is generated. The user must change it at first login."
        footer={<><button className="btn-secondary flex-1" onClick={() => setForm(null)}>Cancel</button>
          <button className="btn-primary flex-1" form="userForm" disabled={busy}>Create user</button></>}>
        {form && (
          <form id="userForm" onSubmit={create} className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><input className="input" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
            <Field label="Business name"><input className="input" value={form.business_name} onChange={(e) => setForm({ ...form, business_name: e.target.value })} /></Field>
            <Field label="Email (login)"><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Currency" hint="3-letter code, e.g. AED, INR, SAR, USD">
              <input className="input uppercase" maxLength={3} required value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></Field>
          </form>
        )}
      </Modal>

      <Modal open={!!cred} onClose={() => setCred(null)} title={cred?.title} size="sm"
        footer={<button className="btn-primary w-full" onClick={() => setCred(null)}>Done</button>}>
        {cred && (
          <div className="space-y-3 text-sm">
            <p className="text-slate-600">Share these credentials securely. The temporary password is shown <b>only once</b>.</p>
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Email</div><div className="font-semibold">{cred.email}</div>
              <div className="mt-2 text-xs text-slate-500">Temporary password</div>
              <div className="font-mono text-lg font-bold tracking-wide">{cred.temp_password}</div>
            </div>
            <button className="btn-secondary w-full" onClick={() => {
              navigator.clipboard?.writeText(`Email: ${cred.email}\nTemporary password: ${cred.temp_password}`);
              toast('Copied to clipboard');
            }}>Copy credentials</button>
          </div>
        )}
      </Modal>

      <ConfirmModal open={!!confirm} onClose={() => setConfirm(null)} onConfirm={doConfirm} busy={busy}
        danger={confirm?.type === 'toggle' && confirm?.user.is_active}
        title={confirm?.type === 'reset' ? 'Reset password?' : confirm?.user.is_active ? 'Disable user?' : 'Enable user?'}
        confirmLabel={confirm?.type === 'reset' ? 'Reset password' : confirm?.user.is_active ? 'Disable' : 'Enable'}
        message={confirm?.type === 'reset'
          ? `A new temporary password will be generated for ${confirm?.user.email}. They will be signed out and must set a new password at next login.`
          : confirm?.user.is_active
            ? `${confirm?.user.email} will be signed out immediately and will not be able to log in. Their data is kept.`
            : `${confirm?.user.email} will be able to log in again.`} />
    </>
  );
}
