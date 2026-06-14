import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { base44 } from '@/api/base44Client';
import { useCompany } from '@/lib/companyContext';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, Wrench, Package, Truck, Zap, HardHat, ArrowLeftRight, Search, CheckCircle, Clock, Pencil, Trash2, X, Plus, History, LogIn, LogOut, ClipboardList, AlertTriangle, Check, Mail, ChevronDown, ChevronUp, Camera, Loader2 } from 'lucide-react';
import { useRef } from 'react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';

const categoryIcons = {
  machinery: Truck,
  tools: Wrench,
  vehicle: Truck,
  safety: HardHat,
  electrical: Zap,
  other: Package,
};

const statusConfig = {
  available: { label: 'Available', color: 'text-green-400', bg: 'bg-green-500/15 border-green-500/25' },
  checked_out: { label: 'Checked Out', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-500/25' },
  maintenance: { label: 'Maintenance', color: 'text-rose-400', bg: 'bg-rose-500/15 border-rose-500/25' },
};

export default function Equipment() {
  const { company } = useCompany();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [equipment, setEquipment] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [actionLoading, setActionLoading] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [editSaving, setEditSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', equipment_id: '', category: 'tools', status: 'available', notes: '' });
  const [addSaving, setAddSaving] = useState(false);
  const [tab, setTab] = useState('equipment');
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [preStarts, setPreStarts] = useState([]);
  const [preStartsLoading, setPreStartsLoading] = useState(false);
  const [expandedPreStart, setExpandedPreStart] = useState(null);
  const [emailModalPs, setEmailModalPs] = useState(null);
  const [emailAddress, setEmailAddress] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [uploadingPhotoId, setUploadingPhotoId] = useState(null);
  const photoInputRef = useRef(null);
  const uploadingForId = useRef(null);

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
    loadEquipment();
  }, []);

  useEffect(() => {
    if (tab === 'history') {
      setLogsLoading(true);
      base44.entities.EquipmentLog.filter({ company_id: company?.id }, '-timestamp', 100).then(data => {
        setLogs(data);
        setLogsLoading(false);
      });
    }
    if (tab === 'prestarts') {
      setPreStartsLoading(true);
      const filter = user?.role === 'admin'
        ? { company_id: company?.id }
        : { company_id: company?.id, worker_email: user?.email };
      base44.entities.PreStart.filter(filter, '-created_date', 100).then(data => {
        setPreStarts(data);
        setPreStartsLoading(false);
      });
    }
  }, [tab, user]);

  const loadEquipment = async () => {
    const data = await base44.entities.Equipment.filter({ company_id: company?.id }, '-created_date');
    setEquipment(data);
    setLoading(false);
  };

  const handleCheckout = async (item) => {
    if (!user) return;
    setActionLoading(item.id);
    await base44.entities.Equipment.update(item.id, {
      company_id: company?.id,
      status: 'checked_out',
      checked_out_by_email: user.email,
      checked_out_by_name: user.full_name,
      checked_out_at: new Date().toISOString(),
    });
    await base44.entities.EquipmentLog.create({
      company_id: company?.id,
      equipment_id: item.id,
      equipment_name: item.name,
      worker_email: user.email,
      worker_name: user.full_name,
      action: 'checked_out',
      timestamp: new Date().toISOString(),
    });
    toast.success(`${item.name} checked out!`);
    setActionLoading(null);
    loadEquipment();
  };

  const handleReturn = async (item) => {
    setActionLoading(item.id);
    await base44.entities.Equipment.update(item.id, {
      status: 'available',
      checked_out_by_email: null,
      checked_out_by_name: null,
      checked_out_at: null,
    });
    await base44.entities.EquipmentLog.create({
      company_id: company?.id,
      equipment_id: item.id,
      equipment_name: item.name,
      worker_email: user.email,
      worker_name: user.full_name,
      action: 'returned',
      timestamp: new Date().toISOString(),
    });
    toast.success(`${item.name} returned!`);
    setActionLoading(null);
    loadEquipment();
  };

  const handleDelete = async (item) => {
    await base44.entities.Equipment.delete(item.id);
    setEquipment(equipment.filter(e => e.id !== item.id));
    toast.success(`${item.name} deleted`);
  };

  const openEdit = (item) => {
    setEditItem(item);
    setEditForm({ name: item.name, equipment_id: item.equipment_id, category: item.category, status: item.status, notes: item.notes || '' });
  };

  const handleEditSave = async () => {
    setEditSaving(true);
    await base44.entities.Equipment.update(editItem.id, editForm);
    toast.success('Equipment updated');
    setEditItem(null);
    setEditSaving(false);
    loadEquipment();
  };

  const handleAddSave = async () => {
    if (!addForm.name || !addForm.equipment_id) { toast.error('Name and Equipment ID are required'); return; }
    setAddSaving(true);
    await base44.entities.Equipment.create({ ...addForm, company_id: company?.id });
    toast.success(`${addForm.name} added!`);
    setShowAdd(false);
    setAddForm({ name: '', equipment_id: '', category: 'tools', status: 'available', notes: '' });
    setAddSaving(false);
    loadEquipment();
  };

  const PRESTART_QUESTION_LABELS = [
    "Hours / KMs on asset",
    "Is the asset due for a service?",
    "Do you hold the appropriate License, Qualification or Competency?",
    "Are you Fit for Duty?",
    "Do you understand the PPE requirements?",
    "Have you read and understood the Safe Work Method Statement?",
    "Engine oil, hydraulic oil, coolant, water and fuel — no leaks?",
    "Tyres & Wheel Assembly condition?",
    "Grease applied to all grease points?",
    "General Body Condition?",
    "Lights and Warning Devices?",
    "E-Stop working?",
    "Fire extinguisher attached and serviced?",
    "Battery secure and terminals clean?",
    "Brakes and Air Systems?",
    "Steering working correctly?",
    "Loading bucket in serviceable condition?",
    "Safety stickers present and in good condition?",
    "Two-way radio working and on correct channel?",
    "General Comments",
  ];

  const handleSendPreStartEmail = async () => {
    if (!emailAddress) { toast.error('Enter an email address'); return; }
    setSendingEmail(true);
    const ps = emailModalPs;
    const answers = ps.answers || {};
    const qaLines = PRESTART_QUESTION_LABELS.map((label, idx) => {
      const qId = idx + 1;
      const answer = answers[qId] || '(not answered)';
      return `  Q${qId}. ${label}\n      → ${answer}`;
    }).join('\n');

    const body = `Hi,

Please find below a Pre-Start Checklist submitted via OnSite Timesheet.

─────────────────────────────────────
Date: ${ps.date}
Worker: ${ps.worker_name}
Vehicle/Equipment: ${ps.equipment_name}
Job: ${ps.job_name || 'No job'}${ps.job_number ? ` #${ps.job_number}` : ''}
Status: ${ps.status?.toUpperCase() === 'FAULT' ? '⚠ FAULT' : '✓ PASS'}
─────────────────────────────────────

CHECKLIST ANSWERS

${qaLines}${ps.general_comments ? `\n\n  General Comments: "${ps.general_comments}"` : ''}

─────────────────────────────────────
Regards,
OnSite Timesheet`;

    await base44.integrations.Core.SendEmail({
      to: emailAddress,
      subject: `Pre-Start Checklist – ${ps.equipment_name} – ${ps.date}`,
      body,
    });
    toast.success(`Pre-start emailed to ${emailAddress}`);
    setSendingEmail(false);
    setEmailModalPs(null);
    setEmailAddress('');
  };

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingForId.current) return;
    const itemId = uploadingForId.current;
    setUploadingPhotoId(itemId);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    await base44.entities.Equipment.update(itemId, { photo_url: file_url });
    toast.success('Photo updated!');
    setUploadingPhotoId(null);
    uploadingForId.current = null;
    e.target.value = '';
    loadEquipment();
  };

  const filtered = equipment
    .filter(e => {
      const matchSearch = e.name?.toLowerCase().includes(search.toLowerCase()) || e.equipment_id?.toLowerCase().includes(search.toLowerCase());
      const matchFilter = filter === 'all' || e.status === filter;
      return matchSearch && matchFilter;
    })
    .sort((a, b) => {
      const order = { checked_out: 0, maintenance: 1, available: 2 };
      return (order[a.status] ?? 2) - (order[b.status] ?? 2);
    });

  return (
    <div className="min-h-screen bg-background">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-black flex-1">Equipment</h1>
        {tab === 'equipment' && (
          <button onClick={() => setShowAdd(true)} className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <Plus className="w-5 h-5 text-primary-foreground" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="px-6 mb-4 flex gap-2">
        <button onClick={() => setTab('equipment')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${tab === 'equipment' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
          <Wrench className="w-4 h-4" /> Equipment
        </button>
        <button onClick={() => setTab('history')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${tab === 'history' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
          <History className="w-4 h-4" /> History
        </button>
        <button onClick={() => setTab('prestarts')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${tab === 'prestarts' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
          <ClipboardList className="w-4 h-4" /> Pre-Starts
        </button>
      </div>

      {tab === 'equipment' && <>
      {/* Search */}
      <div className="px-6 mb-3">
        <div className="flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search equipment..."
            className="bg-transparent flex-1 outline-none text-sm placeholder:text-muted-foreground" />
        </div>
      </div>

      {/* Filter */}
      <div className="px-6 mb-4 flex gap-2">
        {['all', 'available', 'checked_out', 'maintenance'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
            {f === 'checked_out' ? 'Out' : f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      </>}

      {/* Edit Modal - rendered via portal to avoid clipping */}
      {editItem && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setEditItem(null)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-black">Edit Equipment</h2>
              <button onClick={() => setEditItem(null)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</label>
                <input value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Equipment ID</label>
                <input value={editForm.equipment_id} onChange={e => setEditForm({...editForm, equipment_id: e.target.value})}
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Category</label>
                  <select value={editForm.category} onChange={e => setEditForm({...editForm, category: e.target.value})}
                    className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary">
                    {['machinery','tools','vehicle','safety','electrical','other'].map(c => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</label>
                  <select value={editForm.status} onChange={e => setEditForm({...editForm, status: e.target.value})}
                    className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary">
                    <option value="available">Available</option>
                    <option value="checked_out">Checked Out</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
                <textarea value={editForm.notes} onChange={e => setEditForm({...editForm, notes: e.target.value})}
                  rows={2} className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary resize-none" />
              </div>
            </div>
            <button onClick={handleEditSave} disabled={editSaving}
              className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 transition-all active:scale-95">
              {editSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Add Modal */}
      {showAdd && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setShowAdd(false)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-black">Add Equipment</h2>
              <button onClick={() => setShowAdd(false)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name *</label>
                <input value={addForm.name} onChange={e => setAddForm({...addForm, name: e.target.value})}
                  placeholder="e.g. Angle Grinder"
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Equipment ID *</label>
                <input value={addForm.equipment_id} onChange={e => setAddForm({...addForm, equipment_id: e.target.value})}
                  placeholder="e.g. EQ-001"
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Category</label>
                  <select value={addForm.category} onChange={e => setAddForm({...addForm, category: e.target.value})}
                    className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary">
                    {['machinery','tools','vehicle','safety','electrical','other'].map(c => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</label>
                  <select value={addForm.status} onChange={e => setAddForm({...addForm, status: e.target.value})}
                    className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary">
                    <option value="available">Available</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Notes</label>
                <textarea value={addForm.notes} onChange={e => setAddForm({...addForm, notes: e.target.value})}
                  rows={2} placeholder="Optional notes..."
                  className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary resize-none" />
              </div>
            </div>
            <button onClick={handleAddSave} disabled={addSaving}
              className="w-full py-3 rounded-2xl bg-primary text-primary-foreground font-bold text-sm disabled:opacity-60 transition-all active:scale-95">
              {addSaving ? 'Adding...' : 'Add Equipment'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* History View */}
      {tab === 'history' && (
        <div className="px-6 space-y-3">
          {logsLoading ? (
            Array(5).fill(0).map((_, i) => <div key={i} className="h-16 rounded-2xl bg-card border border-border animate-pulse" />)
          ) : logs.length === 0 ? (
            <div className="text-center py-16">
              <History className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">No history yet</p>
            </div>
          ) : logs.map((log, i) => (
            <div key={i} className="bg-card border border-border rounded-2xl px-4 py-3 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${log.action === 'checked_out' ? 'bg-amber-500/15' : 'bg-green-500/15'}`}>
                {log.action === 'checked_out'
                  ? <LogOut className="w-4 h-4 text-amber-400" />
                  : <LogIn className="w-4 h-4 text-green-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate">{log.equipment_name}</p>
                <p className="text-xs text-muted-foreground">
                  <span className={log.action === 'checked_out' ? 'text-amber-400 font-semibold' : 'text-green-400 font-semibold'}>
                    {log.action === 'checked_out' ? 'Checked out' : 'Returned'}
                  </span>
                  {' '}by {log.worker_name || log.worker_email}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                {log.timestamp && (
                  <>
                    <p className="text-xs text-muted-foreground">{format(parseISO(log.timestamp), 'd MMM')}</p>
                    <p className="text-xs text-muted-foreground/60">{format(parseISO(log.timestamp), 'h:mm a')}</p>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pre-Starts View */}
      {tab === 'prestarts' && (
        <div className="px-6 space-y-3 pb-6">
          {preStartsLoading ? (
            Array(4).fill(0).map((_, i) => <div key={i} className="h-16 rounded-2xl bg-card border border-border animate-pulse" />)
          ) : preStarts.length === 0 ? (
            <div className="text-center py-16">
              <ClipboardList className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">No pre-starts submitted yet</p>
            </div>
          ) : preStarts.map(ps => {
            const isExpanded = expandedPreStart === ps.id;
            return (
              <div key={ps.id} className={`bg-card border rounded-2xl overflow-hidden transition-all ${ps.status === 'fault' ? 'border-red-500/30' : 'border-border'}`}>
                <button
                  onClick={() => setExpandedPreStart(isExpanded ? null : ps.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left"
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${ps.status === 'fault' ? 'bg-red-500/15' : 'bg-green-500/15'}`}>
                    {ps.status === 'fault'
                      ? <AlertTriangle className="w-4 h-4 text-red-400" />
                      : <Check className="w-4 h-4 text-green-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{ps.equipment_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{ps.worker_name || ps.worker_email} · {ps.job_name || 'No job'}{ps.job_number ? ` #${ps.job_number}` : ''}</p>
                    <p className="text-xs text-muted-foreground/60">{ps.date}</p>
                  </div>
                  <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase flex-shrink-0 mr-1 ${ps.status === 'fault' ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-400'}`}>
                    {ps.status === 'fault' ? '⚠ Fault' : '✓ Pass'}
                  </span>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-border px-4 py-3 space-y-2 bg-muted/30">
                    {ps.answers && Object.entries(ps.answers).map(([qId, answer]) => {
                      const label = PRESTART_QUESTION_LABELS[parseInt(qId) - 1] || `Q${qId}`;
                      const isFaultAnswer = answer?.toLowerCase().includes('problem') || answer?.toLowerCase().includes('fault') || answer?.toLowerCase().includes('not working') || answer?.toLowerCase().includes('no') || answer?.toLowerCase().includes('tagged out') || answer?.toLowerCase().includes('damage') || answer?.toLowerCase().includes('do not');
                      return (
                        <div key={qId} className="flex items-start gap-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5 ${isFaultAnswer ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>Q{qId}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-muted-foreground/60 mb-0.5">{label}</p>
                            <p className="text-xs text-muted-foreground leading-relaxed">{answer}</p>
                          </div>
                        </div>
                      );
                    })}
                    {ps.general_comments && (
                      <div className="mt-2 pt-2 border-t border-border">
                        <p className="text-xs font-semibold text-muted-foreground mb-1">General Comments:</p>
                        <p className="text-xs text-foreground italic">"{ps.general_comments}"</p>
                      </div>
                    )}
                    <button
                      onClick={() => { setEmailModalPs(ps); setEmailAddress(''); }}
                      className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-400 text-sm font-semibold transition-all active:scale-95"
                    >
                      <Mail className="w-4 h-4" />
                      Email This Pre-Start
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Email Pre-Start Modal */}
      {emailModalPs && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center" onClick={() => setEmailModalPs(null)}>
          <div className="bg-card border border-border rounded-t-3xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h2 className="text-lg font-black">Email Pre-Start</h2>
                <p className="text-xs text-muted-foreground">{emailModalPs.equipment_name} · {emailModalPs.date}</p>
              </div>
              <button onClick={() => setEmailModalPs(null)} className="w-8 h-8 rounded-xl bg-secondary flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Send to Email</label>
              <input
                value={emailAddress}
                onChange={e => setEmailAddress(e.target.value)}
                placeholder="safety@company.com"
                type="email"
                className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl px-4 py-3 text-xs text-purple-300 space-y-1">
              <p className="font-semibold">Email will include:</p>
              <p>• Vehicle/equipment name, date & job</p>
              <p>• Every question with your answer</p>
              <p>• Pass / Fault status</p>
            </div>
            <button onClick={handleSendPreStartEmail} disabled={sendingEmail}
              className="w-full py-3 rounded-2xl bg-purple-500/80 text-white font-bold text-sm disabled:opacity-60 transition-all active:scale-95 flex items-center justify-center gap-2">
              <Mail className="w-4 h-4" />
              {sendingEmail ? 'Sending...' : 'Send Pre-Start Report'}
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* Hidden photo upload input */}
      <input ref={photoInputRef} type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />

      {/* Equipment List */}
      {tab === 'equipment' && <div className="px-6 space-y-3">
        {loading ? (
          Array(4).fill(0).map((_, i) => <div key={i} className="h-28 rounded-2xl bg-card border border-border animate-pulse" />)
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Wrench className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No equipment found</p>
          </div>
        ) : filtered.map(item => {
          const Icon = categoryIcons[item.category] || Package;
          const sc = statusConfig[item.status] || statusConfig.available;
          const isMyCheckout = item.checked_out_by_email === user?.email;

          return (
            <div key={item.id} className="bg-card border border-border rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <button
                  onClick={() => { uploadingForId.current = item.id; photoInputRef.current?.click(); }}
                  disabled={uploadingPhotoId === item.id}
                  className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0 overflow-hidden relative group"
                >
                  {uploadingPhotoId === item.id ? (
                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                  ) : item.photo_url ? (
                    <>
                      <img src={item.photo_url} alt={item.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity">
                        <Camera className="w-4 h-4 text-white" />
                      </div>
                    </>
                  ) : (
                    <>
                      <Icon className="w-5 h-5 text-muted-foreground group-active:opacity-50 transition-opacity" />
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity rounded-xl">
                        <Camera className="w-4 h-4 text-white" />
                      </div>
                    </>
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold">{item.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{item.equipment_id}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={`text-[10px] px-2 py-1 rounded-full border font-semibold uppercase ${sc.bg} ${sc.color}`}>
                        {sc.label}
                      </span>
                      <button onClick={() => openEdit(item)} className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center hover:bg-primary/20 transition-colors">
                        <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                      <button onClick={() => handleDelete(item)} className="w-7 h-7 rounded-lg bg-destructive/10 flex items-center justify-center hover:bg-destructive/20 transition-colors">
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </button>
                    </div>
                  </div>

                  {item.status === 'checked_out' && (
                    <div className="flex items-center gap-1.5 mt-2">
                      <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
                        <span className="text-[9px] font-bold">{item.checked_out_by_name?.charAt(0)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.checked_out_by_name}</p>
                      {item.checked_out_at && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <Clock className="w-3 h-3 text-muted-foreground/60" />
                          <p className="text-xs text-muted-foreground/60">
                            {format(parseISO(item.checked_out_at), 'h:mm a')}
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.status === 'available' && (
                      <button onClick={() => handleCheckout(item)} disabled={actionLoading === item.id}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/15 text-primary text-xs font-semibold transition-all active:scale-95 disabled:opacity-60">
                        <ArrowLeftRight className="w-3.5 h-3.5" />
                        Check Out
                      </button>
                    )}
                    {item.status === 'checked_out' && isMyCheckout && (
                      <button onClick={() => handleReturn(item)} disabled={actionLoading === item.id}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-green-500/15 text-green-400 text-xs font-semibold transition-all active:scale-95 disabled:opacity-60">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Return
                      </button>
                    )}
                    {item.category === 'vehicle' && (
                      <button onClick={() => navigate(`/prestart?equipment_id=${item.id}`)}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500/15 text-amber-400 text-xs font-semibold transition-all active:scale-95 border border-amber-500/30">
                        <ClipboardList className="w-3.5 h-3.5" />
                        Pre-Start
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>}
    </div>
  );
}
