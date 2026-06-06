import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/companyContext';
import { Link } from 'react-router-dom';
import { ChevronLeft, CalendarOff, Plus, X, Check, Clock, CheckCircle, XCircle } from 'lucide-react';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { toast } from 'sonner';

const leaveTypeColors = {
  annual:   'bg-blue-500/15 text-blue-400 border-blue-500/25',
  sick:     'bg-rose-500/15 text-rose-400 border-rose-500/25',
  personal: 'bg-purple-500/15 text-purple-400 border-purple-500/25',
  other:    'bg-secondary text-muted-foreground border-border',
};

const statusConfig = {
  pending:  { label: 'Pending',  icon: Clock,        color: 'text-amber-400',  bg: 'bg-amber-500/15'  },
  approved: { label: 'Approved', icon: CheckCircle,  color: 'text-green-400',  bg: 'bg-green-500/15'  },
  declined: { label: 'Declined', icon: XCircle,      color: 'text-rose-400',   bg: 'bg-rose-500/15'   },
};

export default function Leave() {
  const { company } = useCompany();
  const [user, setUser]         = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ leave_type: 'annual', start_date: '', end_date: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const isAdmin = user?.role === 'admin' || (company && company.owner_email === user?.email);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      loadRequests(u);
    }).catch(() => setLoading(false));
  }, []);

  const loadRequests = async (u) => {
    const all = await base44.entities.LeaveRequest.filter({ company_id: company?.id }, '-created_date');
    // Admins see all, workers see only their own
    setRequests(u?.role === 'admin' ? all : all.filter(r => r.worker_email === u?.email));
    setLoading(false);
  };

  const handleSubmit = async () => {
    if (!form.start_date || !form.end_date) { toast.error('Please fill in dates'); return; }
    setSaving(true);
    await base44.entities.LeaveRequest.create({
      ...form,
      company_id: company?.id,
      worker_email: user.email,
      worker_name: user.full_name,
      status: 'pending',
    });
    toast.success('Leave request submitted!');
    setShowModal(false);
    setForm({ leave_type: 'annual', start_date: '', end_date: '', notes: '' });
    setSaving(false);
    loadRequests(user);
  };

  const handleStatus = async (id, status) => {
    await base44.entities.LeaveRequest.update(id, { status });
    toast.success(`Request ${status}`);
    loadRequests(user);
  };

  const handleDelete = async (id) => {
    await base44.entities.LeaveRequest.delete(id);
    toast.success('Request deleted');
    loadRequests(user);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-black flex-1">Leave Requests</h1>
        <button onClick={() => setShowModal(true)}
          className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
          <Plus className="w-5 h-5 text-primary-foreground" />
        </button>
      </div>

      {/* List */}
      <div className="px-6 space-y-3">
        {loading ? (
          Array(3).fill(0).map((_, i) => <div key={i} className="h-20 rounded-2xl bg-card border border-border animate-pulse" />)
        ) : requests.length === 0 ? (
          <div className="text-center py-16">
            <CalendarOff className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No leave requests yet</p>
            <p className="text-muted-foreground/60 text-sm mt-1">Tap + to submit one</p>
          </div>
        ) : requests.map(r => {
          const sc = statusConfig[r.status] || statusConfig.pending;
          const StatusIcon = sc.icon;
          const days = r.start_date && r.end_date
            ? differenceInCalendarDays(parseISO(r.end_date), parseISO(r.start_date)) + 1
            : null;

          return (
            <div key={r.id} className="bg-card border border-border rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {isAdmin && (
                    <p className="font-bold text-sm">{r.worker_name || r.worker_email}</p>
                  )}
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold uppercase ${leaveTypeColors[r.leave_type]}`}>
                      {r.leave_type}
                    </span>
                    <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${sc.bg} ${sc.color}`}>
                      <StatusIcon className="w-3 h-3" />
                      {sc.label}
                    </span>
                  </div>
                  <p className="text-sm font-semibold mt-1.5">
                    {r.start_date && format(parseISO(r.start_date), 'd MMM yyyy')}
                    {' → '}
                    {r.end_date && format(parseISO(r.end_date), 'd MMM yyyy')}
                    {days && <span className="text-xs text-muted-foreground ml-1">({days} day{days > 1 ? 's' : ''})</span>}
                  </p>
                  {r.notes && <p className="text-xs text-muted-foreground mt-1">{r.notes}</p>}
                </div>

                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  {isAdmin && r.status === 'pending' && (
                    <>
                      <button onClick={() => handleStatus(r.id, 'approved')}
                        className="w-8 h-8 rounded-lg bg-green-500/15 flex items-center justify-center hover:bg-green-500/25 transition-colors">
                        <Check className="w-3.5 h-3.5 text-green-400" />
                      </button>
                      <button onClick={() => handleStatus(r.id, 'declined')}
                        className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center hover:bg-rose-500/20 transition-colors">
                        <X className="w-3.5 h-3.5 text-rose-400" />
                      </button>
                    </>
                  )}
                  {(isAdmin || r.status === 'pending') && (
                    <button onClick={() => handleDelete(r.id)}
                      className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center hover:bg-muted transition-colors">
                      <X className="w-3 h-3 text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Apply Modal */}
      {showModal && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setShowModal(false)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-black">Apply for Leave</h2>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Leave Type</label>
                <select value={form.leave_type} onChange={e => setForm({ ...form, leave_type: e.target.value })}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary">
                  <option value="annual">Annual Leave</option>
                  <option value="sick">Sick Leave</option>
                  <option value="personal">Personal Leave</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Start Date</label>
                  <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })}
                    className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <div className="flex-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">End Date</label>
                  <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })}
                    className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes (optional)</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2} placeholder="Any additional details..."
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary resize-none" />
              </div>
            </div>
            <button onClick={handleSubmit} disabled={saving}
              className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 transition-all active:scale-95">
              {saving ? 'Submitting...' : 'Submit Leave Request'}
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}