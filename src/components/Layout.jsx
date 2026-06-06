import { Outlet, Link, useLocation } from 'react-router-dom';
import { Home, User, Briefcase, Clock, MessageSquare, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/', icon: Home, label: 'Home' },
  { path: '/profile', icon: User, label: 'Profile' },
  { path: '/jobs', icon: Briefcase, label: 'Jobs' },
  { path: '/timesheets', icon: Clock, label: 'Time' },
  { path: '/messages', icon: MessageSquare, label: 'Messages' },
  { path: '/equipment', icon: Wrench, label: 'Equipment' },
];

export default function Layout() {
  const location = useLocation();

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 pb-20">
        <Outlet />
      </main>

      {/* Bottom Nav Bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t" style={{ backgroundColor: '#080808', borderColor: '#10B981' }}>
        <div className="flex items-center justify-around px-2 py-2">
          {navItems.map(({ path, icon: Icon, label }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-all duration-200 min-w-[52px]"
              >
                <Icon className="w-5 h-5" style={{ color: active ? '#10B981' : '#6b7280' }} />
                <span className="text-[10px] font-medium" style={{ color: active ? '#10B981' : '#6b7280' }}>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}