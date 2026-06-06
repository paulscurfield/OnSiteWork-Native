import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/companyContext';
import {
  Briefcase, Clock, Wrench, MessageSquare, Users, Camera,
  ShieldCheck, CalendarCheck, User, Home, ChevronRight
} from 'lucide-react';
import { format } from 'date-fns';

const gridCards = [
  { path: '/jobs',        icon: Briefcase,     label: 'JOBS',        desc: 'Job sites & clock in' },
  { path: '/timesheets',  icon: Clock,         label: 'TIMESHEETS',  desc: 'Weekly hours & payroll' },
  { path: '/equipment',   icon: Wrench,        label: 'EQUIPMENT',   desc: 'Tools, vehicles & pre-starts' },
  { path: '/messages',    icon: MessageSquare, label: 'MESSAGES',    desc: 'Team communication' },
  { path: '/team-map',    icon: Users,         label: 'TEAM MAP',    desc: "See who's on site" },
  { path: '/site-photos', icon: Camera,        label: 'SITE PHOTOS', desc: 'Capture & upload photos' },
  { path: '/admin',       icon: ShieldCheck,   label: 'ADMIN',       desc: 'Manage & export data' },
  { path: '/leave',       icon: CalendarCheck, label: 'LEAVE',       desc: 'Apply for time off' },
  { path: '/profile',     icon: User,          label: 'PROFILE',     desc: 'Your details & role' },
];

const bottomNav = [
  { path: '/',           icon: Home,          label: 'Home' },
  { path: '/profile',    icon: User,          label: 'Profile' },
  { path: '/jobs',       icon: Briefcase,     label: 'Jobs' },
  { path: '/timesheets', icon: Clock,         label: 'Time' },
  { path: '/messages',   icon: MessageSquare, label: 'Messages' },
  { path: '/equipment',  icon: Wrench,        label: 'Equipment' },
];

const GREEN = '#16a34a';

export default function Dashboard() {
  const { company } = useCompany();
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [activeEntry, setActiveEntry] = useState(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [unreadCount, setUnreadCount] = useState(0);
  const [clockingOut, setClockingOut] = useState(false);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      loadUnread(u);
    }).catch(() => {});
    loadActiveEntry();
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, [company]);

  useEffect(() => {
    if (user) loadUnread(user);
  }, [location]);

  const loadUnread = async (u) => {
    if (!company) return;
    base44.entities.Message.filter({ company_id: company.id }, '-created_date').then(msgs => {
      const unread = msgs.filter(m => (m.recipient_email === u.email || m.recipient_email === 'all') && !m.is_read);
      setUnreadCount(unread.length);
    }).catch(() => {});
  };

  const loadActiveEntry = async () => {
    if (!company) return;
    const entries = await base44.entities.TimeEntry.filter({ company_id: company.id, status: 'active' });
    setActiveEntry(entries.length > 0 ? entries[0] : null);
  };

  const handleClockOut = async () => {
    if (!activeEntry) return;
    setClockingOut(true);
    const finishTime = new Date().toISOString();
    const rawHours = (new Date(finishTime) - new Date(activeEntry.start_time)) / 3600000;
    const totalHours = Math.round((rawHours - (activeEntry.lunch_break_mins || 0) / 60) * 100) / 100;
    await base44.entities.TimeEntry.update(activeEntry.id, {
      finish_time: finishTime,
      total_hours: totalHours,
      status: 'completed',
      worker_lat: null,
      worker_lng: null,
    });
    setActiveEntry(null);
    setClockingOut(false);
  };

  const getElapsed = () => {
    if (!activeEntry?.start_time) return '';
    const start = new Date(activeEntry.start_time);
    const diff = Math.floor((currentTime - start) / 1000);
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    const s = diff % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const sinceTime = activeEntry?.start_time
    ? format(new Date(activeEntry.start_time), 'h:mm a')
    : '';

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#0a0a0a' }}>
      {/* Hero Header */}
      <div className="relative overflow-hidden" style={{ minHeight: 200 }}>
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, #111 0%, #0a0a0a 100%)' }} />

        <div className="relative z-10 pt-12 pb-4 px-5">
          {/* Logo row */}
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="relative flex items-center justify-center w-14 h-14">
              <span className="font-black leading-none absolute" style={{ color: GREEN, fontSize: '4rem' }}>O</span>
              <span className="font-black leading-none relative z-10 px-1 rounded" style={{ color: GREEN, fontSize: '1.5rem', textShadow: `0 0 8px #0a0a0a, 0 0 4px #0a0a0a, -1px -1px 0 #0a0a0a, 1px -1px 0 #0a0a0a, -1px 1px 0 #0a0a0a, 1px 1px 0 #0a0a0a` }}>W</span>
            </div>
            <div>
              <p className="font-black text-3xl text-white leading-none tracking-tight">ONESITE</p>
              <p className="font-black text-lg tracking-widest leading-none" style={{ color: GREEN }}>WORKS</p>
            </div>
          </div>

          {/* Time */}
          <div className="flex items-center justify-center gap-3">
            <div className="h-px w-12" style={{ backgroundColor: GREEN }} />
            <Clock className="w-5 h-5" style={{ color: GREEN }} />
            <p className="font-black text-4xl text-white tracking-tight">
              {format(currentTime, 'h:mm')}{' '}
              <span className="text-2xl font-bold">{format(currentTime, 'a')}</span>
            </p>
            <div className="h-px w-12" style={{ backgroundColor: GREEN }} />
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 px-3 pb-28 space-y-3 mt-2">

        {/* Status Card */}
        <div className="rounded-2xl p-4 border" style={{ backgroundColor: '#111', borderColor: '#2a2a2a' }}>
          {activeEntry ? (
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full border-2 flex items-center justify-center flex-shrink-0" style={{ borderColor: GREEN }}>
                <Clock className="w-6 h-6" style={{ color: GREEN }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Current Status</p>
                <p className="font-black text-white text-lg leading-tight">CLOCKED IN</p>
                <p className="font-bold text-sm truncate" style={{ color: GREEN }}>{activeEntry.job_name}</p>
                <p className="text-xs text-gray-400">Since {sinceTime} · {getElapsed()}</p>
              </div>
              <button
                onClick={handleClockOut}
                disabled={clockingOut}
                className="flex items-center gap-2 px-4 py-3 rounded-xl font-black text-sm uppercase tracking-wide flex-shrink-0 transition-all active:scale-95 disabled:opacity-60"
                style={{ backgroundColor: GREEN, color: '#000' }}
              >
                <Clock className="w-4 h-4" />
                {clockingOut ? '...' : 'CLOCK OUT'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full border-2 flex items-center justify-center flex-shrink-0" style={{ borderColor: '#444' }}>
                <Clock className="w-6 h-6 text-gray-500" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">Current Status</p>
                <p className="font-black text-white text-lg">NOT CLOCKED IN</p>
                <p className="text-xs text-gray-500">Tap Jobs to clock in</p>
              </div>
              <Link to="/jobs">
                <div className="flex items-center gap-2 px-4 py-3 rounded-xl font-black text-sm uppercase tracking-wide"
                  style={{ backgroundColor: GREEN, color: '#000' }}>
                  <Briefcase className="w-4 h-4" />
                  CLOCK IN
                </div>
              </Link>
            </div>
          )}
        </div>

        {/* 3-column grid */}
        <div className="grid grid-cols-3 gap-2">
          {gridCards.map(({ path, icon: Icon, label, desc }) => (
            <Link key={path} to={path}>
              <div
                className="rounded-2xl p-3 border flex flex-col justify-between transition-all active:scale-95"
                style={{ backgroundColor: '#111', borderColor: '#222', minHeight: 120 }}
              >
                <Icon className="w-7 h-7 mb-2" style={{ color: GREEN }} />
                <div>
                  <div className="flex items-center justify-between">
                    <p className="font-black text-white text-xs uppercase tracking-wide leading-tight">{label}</p>
                    <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: GREEN }} />
                  </div>
                  <p className="text-gray-400 text-[10px] mt-0.5 leading-tight">{desc}</p>
                  {path === '/messages' && unreadCount > 0 && (
                    <span className="mt-1 inline-block w-4 h-4 rounded-full bg-red-500 text-[9px] font-black text-white text-center leading-4">{unreadCount}</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-0 right-0 border-t flex" style={{ backgroundColor: '#0a0a0a', borderColor: '#1a1a1a' }}>
        {bottomNav.map(({ path, icon: Icon, label }) => {
          const active = location.pathname === path;
          return (
            <Link key={path} to={path} className="flex-1 flex flex-col items-center justify-center py-3 gap-1">
              <Icon className="w-5 h-5" style={{ color: active ? GREEN : '#555' }} />
              <span className="text-[10px] font-semibold" style={{ color: active ? GREEN : '#555' }}>{label}</span>
              {active && <div className="w-4 h-0.5 rounded-full" style={{ backgroundColor: GREEN }} />}
            </Link>
          );
        })}
      </div>
    </div>
  );
}