import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Briefcase, Clock3 } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { onsiteApi } from '@/api/supabase/adapter';
import ModuleIcon from '@/components/navigation/ModuleIcon';
import { useCompany } from '@/lib/companyContext';
import { DASHBOARD_MODULES } from '@/navigation/dashboard-modules';

const BrandMark = () => (
  <div className="flex items-center gap-3" aria-label="On-Site Work">
    <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10">
      <span className="text-2xl font-black text-emerald-400">OW</span>
    </div>
    <div>
      <p className="text-xs font-bold uppercase tracking-[0.28em] text-emerald-400">On-Site</p>
      <p className="text-2xl font-black leading-none text-white">Work</p>
    </div>
  </div>
);

const DashboardTile = ({ module }) => (
  <Link
    to={module.path}
    className="group flex min-h-40 flex-col justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-emerald-400/50 hover:bg-emerald-400/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0d0b]"
    aria-label={`Open ${module.label}`}
  >
    <div className="flex items-start justify-between gap-4">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-400">
        <ModuleIcon name={module.icon} className="h-5 w-5" />
      </span>
      <ArrowUpRight aria-hidden="true" className="h-5 w-5 text-white/30 transition group-hover:text-emerald-400" />
    </div>
    <div>
      <h2 className="text-lg font-extrabold tracking-tight text-white">{module.label}</h2>
      <p className="mt-1 text-sm leading-5 text-zinc-400">{module.description}</p>
    </div>
  </Link>
);

const MobileClockStatus = ({ activeEntry, clockingOut, elapsed, onClockOut, sinceTime }) => (
  <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 md:hidden" aria-label="Clock status">
    {activeEntry ? (
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 border-emerald-500">
          <Clock3 className="h-6 w-6 text-emerald-500" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Current status</p>
          <p className="text-lg font-black text-white">Clocked in</p>
          <p className="truncate text-sm font-bold text-emerald-400">{activeEntry.job_name}</p>
          <p className="text-xs text-zinc-400">Since {sinceTime} · {elapsed}</p>
        </div>
        <button
          type="button"
          onClick={onClockOut}
          disabled={clockingOut}
          className="min-h-11 flex-shrink-0 rounded-xl bg-emerald-500 px-4 text-xs font-black uppercase tracking-wide text-black transition active:scale-95 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          {clockingOut ? 'Working…' : 'Clock out'}
        </button>
      </div>
    ) : (
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border-2 border-zinc-700">
          <Clock3 className="h-6 w-6 text-zinc-500" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Current status</p>
          <p className="text-lg font-black text-white">Not clocked in</p>
          <p className="text-xs text-zinc-500">Choose a job to clock in.</p>
        </div>
        <Link
          to="/jobs"
          className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-xs font-black uppercase tracking-wide text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <Briefcase className="h-4 w-4" />
          Jobs
        </Link>
      </div>
    )}
  </section>
);

export default function Dashboard() {
  const { company } = useCompany();
  const requestIdRef = useRef(0);
  const [activeEntry, setActiveEntry] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [clockingOut, setClockingOut] = useState(false);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setActiveEntry(null);

    if (company) {
      const loadActiveEntry = async () => {
        try {
          const activeTimeEntry = await onsiteApi.tables.timeEntries.getMyActive(company.id);
          if (requestId === requestIdRef.current) setActiveEntry(activeTimeEntry);
        } catch (error) {
          if (requestId === requestIdRef.current) {
            console.error('Failed to load Supabase active TimeEntry:', error);
            setActiveEntry(null);
          }
        }
      };
      loadActiveEntry();
    }

    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => {
      requestIdRef.current += 1;
      clearInterval(timer);
    };
  }, [company]);

  const handleClockOut = async () => {
    if (!activeEntry || clockingOut) return;
    setClockingOut(true);
    try {
      await onsiteApi.tables.timeEntries.clockOut(activeEntry.id, {
        finish_time: new Date().toISOString(),
        lunch_break_mins: activeEntry.lunch_break_mins ?? 0,
      });
      setActiveEntry(null);
    } catch (error) {
      console.error('Failed to clock out with Supabase:', error);
      toast.error(error.message || 'Failed to clock out');
    } finally {
      setClockingOut(false);
    }
  };

  const elapsed = (() => {
    if (!activeEntry?.start_time) return '';
    const diff = Math.max(0, Math.floor((currentTime.getTime() - new Date(activeEntry.start_time).getTime()) / 1000));
    const values = [Math.floor(diff / 3600), Math.floor((diff % 3600) / 60), diff % 60];
    return values.map(value => String(value).padStart(2, '0')).join(':');
  })();

  const sinceTime = activeEntry?.start_time ? format(new Date(activeEntry.start_time), 'h:mm a') : '';

  return (
    <div className="min-h-screen bg-[#0a0d0b] text-white">
      <div className="mx-auto w-full max-w-[1500px] px-4 pb-28 pt-8 sm:px-6 md:px-8 md:pb-12 md:pt-10 xl:px-12">
        <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#162019] via-[#101511] to-[#0d100e] p-6 shadow-2xl shadow-black/20 sm:p-8 md:p-10">
          <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
            <div>
              <BrandMark />
              <div className="mt-8 max-w-3xl">
                <p className="text-sm font-bold uppercase tracking-[0.2em] text-emerald-400">Administration workspace</p>
                <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl lg:text-5xl">Keep every job moving.</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400 sm:text-base">
                  Open the company tools you need, then work from the job context for site records and purchasing.
                </p>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 px-5 py-4 md:min-w-64">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Active workspace</p>
              <p className="mt-1 truncate text-base font-bold text-white">{company?.name || 'Company workspace'}</p>
              <p className="mt-1 text-xs text-zinc-500">Company access is applied to every module.</p>
            </div>
          </div>
        </header>

        <div className="mt-5">
          <MobileClockStatus
            activeEntry={activeEntry}
            clockingOut={clockingOut}
            elapsed={elapsed}
            onClockOut={handleClockOut}
            sinceTime={sinceTime}
          />
        </div>

        <section className="mt-8" aria-labelledby="workspace-tools-heading">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 id="workspace-tools-heading" className="text-xl font-black text-white sm:text-2xl">Workspace tools</h2>
              <p className="mt-1 text-sm text-zinc-500">Select a module to continue.</p>
            </div>
            <p className="hidden text-sm font-semibold text-zinc-500 md:block">12 modules</p>
          </div>
          <div className="grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {DASHBOARD_MODULES.map(module => <DashboardTile key={module.key} module={module} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
