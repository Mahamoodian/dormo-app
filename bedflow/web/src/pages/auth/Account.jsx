import { useAuth } from '../../context/AuthContext.jsx';
import { PageHeader } from '../../components/ui.jsx';
import { PasswordForm } from './ChangePassword.jsx';

export default function Account() {
  const { user, logout } = useAuth();
  return (
    <div className="max-w-xl">
      <PageHeader title="Account" />
      <div className="card mb-4 divide-y divide-slate-100">
        {[['Name', user.full_name], ['Business', user.business_name || '—'], ['Email', user.email], ['Phone', user.phone || '—'],
          ['Currency', user.currency], ['Role', user.role === 'super_admin' ? 'Super Admin' : 'Business Owner']].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-4 py-3 text-sm"><span className="text-slate-500">{k}</span><span className="text-right font-medium">{v}</span></div>
        ))}
      </div>
      <div className="card p-5">
        <h2 className="mb-4 font-semibold">Change password</h2>
        <PasswordForm />
      </div>
      <button className="btn-secondary mt-4 w-full lg:hidden" onClick={logout}>Sign out</button>
    </div>
  );
}
