import { Link, Outlet, useLocation } from 'react-router-dom';
import { Briefcase, CalendarDays, Clock, Home, MessageSquare, User, Wrench } from 'lucide-react';
import ModuleIcon from '@/components/navigation/ModuleIcon';
import { useCompany } from '@/lib/companyContext';
import { DASHBOARD_MODULES } from '@/navigation/dashboard-modules';

const mobileNavItems = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/profile', icon: User, label: 'Profile' },
  { path: '/jobs', icon: Briefcase, label: 'Jobs' },
  { path: '/calendar', icon: CalendarDays, label: 'Calendar' },
  { path: '/timesheets', icon: Clock, label: 'Time' },
  { path: '/messages', icon: MessageSquare, label: 'Messages' },
  { path: '/equipment', icon: Wrench, label: 'Equipment' },
];

const isModuleActive = (pathname, module) => (
  module.jobFirst ? pathname.startsWith(`/work/${module.key}/`) : pathname === module.path
);

export default function Layout() {
  const location = useLocation();
  const { company, workspaces, switchingWorkspaceId, switchWorkspace } = useCompany();
  const hasWorkspaceChoice = workspaces.length > 1;

  const handleWorkspaceChange = event => {
    if (event.target.value === company?.id) return;
    switchWorkspace(event.target.value).catch(() => undefined);
  };

  const workspaceControl = hasWorkspaceChoice ? (
    <label className="block min-w-0">
      <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">Active workspace</span>
      <select
        value={company?.id || ''}
        disabled={Boolean(switchingWorkspaceId)}
        onChange={handleWorkspaceChange}
        className="mt-1 min-h-11 w-full rounded-xl border border-white/10 bg-[#111512] px-3 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-60"
        aria-label="Active company workspace"
      >
        {workspaces.map(workspace => (
          <option key={workspace.companyId} value={workspace.companyId}>{workspace.companyName}</option>
        ))}
      </select>
    </label>
  ) : (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-600">Active workspace</p>
      <p className="mt-1 truncate text-sm font-semibold text-zinc-300">{company?.name || 'Company access required'}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 flex-col border-r border-white/10 bg-[#090c0a] lg:flex">
        <Link
          to="/"
          className="m-5 flex items-center gap-3 rounded-2xl p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          aria-label="On-Site Work dashboard"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-lg font-black text-emerald-400">OW</span>
          <span>
            <span className="block text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">On-Site</span>
            <span className="block text-lg font-black leading-none text-white">Work</span>
          </span>
        </Link>

        <nav className="flex-1 overflow-y-auto px-4 pb-5" aria-label="Administration modules">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-600">Workspace</p>
          <Link
            to="/"
            className={`mb-1 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${location.pathname === '/' ? 'bg-emerald-400/10 text-emerald-400' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Dashboard
          </Link>
          {DASHBOARD_MODULES.map(module => {
            const active = isModuleActive(location.pathname, module);
            return (
              <Link
                key={module.key}
                to={module.path}
                className={`mb-1 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${active ? 'bg-emerald-400/10 text-emerald-400' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}
              >
                <ModuleIcon name={module.icon} className="h-4 w-4" />
                <span className="truncate">{module.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-5">
          {workspaceControl}
        </div>
      </aside>

      <main className="min-h-screen pb-20 lg:pl-72 lg:pb-0">
        <div className="border-b border-white/10 bg-[#090c0a] px-4 py-3 lg:hidden">
          {workspaceControl}
        </div>
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-emerald-500 bg-[#080808] lg:hidden" aria-label="Mobile navigation">
        <div className="flex items-center justify-around px-1 py-2">
          {mobileNavItems.map(({ path, icon: Icon, label }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg px-0.5 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <Icon className="h-5 w-5" style={{ color: active ? '#10B981' : '#6b7280' }} aria-hidden="true" />
                <span className="whitespace-nowrap text-[9px] font-medium leading-none sm:text-[10px]" style={{ color: active ? '#10B981' : '#6b7280' }}>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
