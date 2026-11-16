import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import {
  IconHome, IconBed, IconCash, IconUsers, IconReceipt, IconBuilding, IconMenu, IconLogout, IconKey, IconChart, IconShield, IconX,
} from './icons.jsx';

const ownerNav = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: IconHome, end: true, mobile: true },
  { to: '/beds', label: 'Beds', icon: IconBed, mobile: true },
  { to: '/receivables', label: 'Receivables', short: 'Collect', icon: IconCash, mobile: true },
  { to: '/clients', label: 'Clients', icon: IconUsers, mobile: true },
  { to: '/expenses', label: 'Expenses', icon: IconReceipt },
  { to: '/properties', label: 'Properties', icon: IconBuilding },
  { to: '/account', label: 'Account', icon: IconKey },
];
const adminNav = [
  { to: '/admin', label: 'Reports', icon: IconChart, end: true, mobile: true },
  { to: '/admin/users', label: 'Users', icon: IconUsers, mobile: true },
  { to: '/account', label: 'Account', icon: IconKey, mobile: true },
];

function Brand({ admin }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-brand-700 text-white"><IconBed className="h-5 w-5" /></div>
      <div className="leading-tight">
        <div className="font-bold tracking-tight">BedFlow</div>
        <div className="text-[11px] font-medium text-slate-500">{admin ? 'Super Admin' : 'Revenue Manager'}</div>
      </div>
    </div>
  );
}

export default function Layout({ admin = false }) {
  const { user, logout } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const loc = useLocation();
  const nav = admin ? adminNav : ownerNav;
  const mobile = nav.filter((n) => n.mobile);
  const extra = nav.filter((n) => !n.mobile);

  const linkCls = ({ isActive }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
      isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`;

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-slate-200 bg-white px-4 py-5 lg:flex">
        <Brand admin={admin} />
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkCls}><Icon />{label}</NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 pt-4">
          <div className="truncate text-sm font-semibold">{user?.business_name || user?.full_name}</div>
          <div className="truncate text-xs text-slate-500">{user?.email}</div>
          <button onClick={logout} className="btn-ghost mt-2 w-full justify-start px-3"><IconLogout />Sign out</button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <Brand admin={admin} />
        {admin && <IconShield className="h-5 w-5 text-brand-700" />}
      </header>

      <main key={loc.pathname} className="mx-auto max-w-6xl px-4 pb-28 pt-4 sm:pt-6 lg:px-8 lg:pb-10">
        <Outlet />
      </main>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${mobile.length + 1}, minmax(0,1fr))` }}>
          {mobile.map(({ to, label, short, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${isActive ? 'text-brand-700' : 'text-slate-500'}`}>
              <Icon className="h-6 w-6" />{short || label}
            </NavLink>
          ))}
          <button onClick={() => setMoreOpen(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold text-slate-500">
            <IconMenu className="h-6 w-6" />More
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/40" />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="font-semibold">{user?.business_name || user?.full_name}</div>
                <div className="text-xs text-slate-500">{user?.email}</div>
              </div>
              <button className="btn-ghost min-h-0 p-2" onClick={() => setMoreOpen(false)}><IconX /></button>
            </div>
            <div className="flex flex-col gap-1">
              {extra.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className={linkCls} onClick={() => setMoreOpen(false)}><Icon />{label}</NavLink>
              ))}
              <button onClick={logout} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50">
                <IconLogout />Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
