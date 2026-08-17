import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  Camera,
  CheckCircle,
  ChevronLeft,
  Clock,
  HardHat,
  History,
  LogIn,
  LogOut,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  Truck,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { onsiteApi } from '@/api/supabase/adapter';

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

const emptyAddForm = { name: '', equipment_id: '', category: 'tools', status: 'available', notes: '' };
const adminRoles = new Set(['owner', 'admin']);
const equipmentPhotoTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const equipmentPhotoMaxBytes = 20 * 1024 * 1024;

const resolveSupabaseCompany = (profile, companyRows) => {
  if (!profile?.id) {
    throw new Error('Not authenticated with Supabase');
  }
  if (companyRows.length === 0) {
    throw new Error('No Supabase company found for this user');
  }
  if (companyRows.length > 1) {
    throw new Error('Multiple Supabase companies found. A company selector is required before Equipment can load safely.');
  }
  return companyRows[0];
};

function EquipmentPhotoThumbnail({ companyId, item, FallbackIcon }) {
  const [photoState, setPhotoState] = useState({ photoPath: '', signedUrl: '', failed: false });
  const currentPhotoPath = item?.photo_path || '';

  useEffect(() => {
    let cancelled = false;
    const photoPath = item?.photo_path || '';
    setPhotoState({ photoPath, signedUrl: '', failed: false });

    if (!companyId || !item?.id || !photoPath) {
      return () => {
        cancelled = true;
      };
    }

    const loadSignedUrl = async () => {
      try {
        const url = await onsiteApi.tables.equipment.getPhotoSignedUrl({
          companyId,
          equipmentId: item.id,
          photoPath,
        });
        if (!cancelled) {
          setPhotoState(current =>
            current.photoPath === photoPath
              ? { photoPath, signedUrl: url, failed: false }
              : current
          );
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to load equipment photo:', error);
          setPhotoState(current =>
            current.photoPath === photoPath
              ? { photoPath, signedUrl: '', failed: true }
              : current
          );
        }
      }
    };

    loadSignedUrl();
    return () => {
      cancelled = true;
    };
  }, [companyId, item?.id, item?.photo_path]);

  const showPhoto = Boolean(
    currentPhotoPath &&
    photoState.photoPath === currentPhotoPath &&
    photoState.signedUrl &&
    !photoState.failed
  );
  const renderedPhotoPath = currentPhotoPath;

  return (
    <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0 overflow-hidden">
      {showPhoto ? (
        <img
          src={photoState.signedUrl}
          alt={`${item.name || 'Equipment'} equipment`}
          className="w-full h-full object-cover"
          onError={() => {
            setPhotoState(current =>
              current.photoPath === renderedPhotoPath
                ? { ...current, failed: true }
                : current
            );
          }}
        />
      ) : (
        <FallbackIcon className="w-5 h-5 text-muted-foreground" />
      )}
    </div>
  );
}

/**
 * @typedef {{
 *   name: string,
 *   equipment_id: string,
 *   category: string,
 *   status: string,
 *   notes: string
 * }} EquipmentEditForm
 */

export default function Equipment() {
  const pageRequestIdRef = useRef(0);
  const equipmentRequestIdRef = useRef(0);
  const logsRequestIdRef = useRef(0);
  const photoInputRef = useRef(null);
  const photoTargetRef = useRef(null);
  const photoActionsRef = useRef({});

  const [profile, setProfile] = useState(null);
  const [supabaseCompany, setSupabaseCompany] = useState(null);
  const [membership, setMembership] = useState(null);
  const [equipment, setEquipment] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [actionLoading, setActionLoading] = useState(null);
  const [photoActions, setPhotoActions] = useState({});
  const [editItem, setEditItem] = useState(null);
  const [editForm, setEditForm] = useState(/** @type {EquipmentEditForm} */ ({}));
  const [editSaving, setEditSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(emptyAddForm);
  const [addSaving, setAddSaving] = useState(false);
  const [tab, setTab] = useState('equipment');
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const isAdmin = adminRoles.has(membership?.role);

  const updateEquipmentRow = (updatedItem) => {
    setEquipment(currentEquipment =>
      currentEquipment.map(item => item.id === updatedItem.id ? updatedItem : item)
    );
  };

  const startPhotoAction = (equipmentId, action) => {
    if (photoActionsRef.current[equipmentId]) return false;
    photoActionsRef.current = {
      ...photoActionsRef.current,
      [equipmentId]: action,
    };
    setPhotoActions(current => ({
      ...current,
      [equipmentId]: action,
    }));
    equipmentRequestIdRef.current += 1;
    return true;
  };

  const finishPhotoAction = (equipmentId) => {
    const nextActions = { ...photoActionsRef.current };
    delete nextActions[equipmentId];
    photoActionsRef.current = nextActions;
    setPhotoActions(current => {
      const next = { ...current };
      delete next[equipmentId];
      return next;
    });
  };

  const refreshEquipment = useCallback(async () => {
    if (!supabaseCompany?.id) return;
    const requestId = equipmentRequestIdRef.current + 1;
    equipmentRequestIdRef.current = requestId;

    try {
      const rows = await onsiteApi.tables.equipment.filter(
        { company_id: supabaseCompany.id },
        '-created_at'
      );
      if (requestId !== equipmentRequestIdRef.current) return;
      setEquipment(rows);
    } catch (error) {
      if (requestId !== equipmentRequestIdRef.current) return;
      console.error('Failed to load Supabase equipment:', error);
      setEquipment([]);
      toast.error('Failed to load equipment');
    }
  }, [supabaseCompany?.id]);

  useEffect(() => {
    const requestId = pageRequestIdRef.current + 1;
    pageRequestIdRef.current = requestId;
    const equipmentRequestId = equipmentRequestIdRef.current + 1;
    equipmentRequestIdRef.current = equipmentRequestId;

    setLoading(true);
    setLoadError('');
    setProfile(null);
    setSupabaseCompany(null);
    setMembership(null);
    setEquipment([]);

    const loadEquipmentPage = async () => {
      try {
        const [resolvedProfile, companyRows] = await Promise.all([
          onsiteApi.auth.me(),
          onsiteApi.tables.companies.list('name'),
        ]);
        if (requestId !== pageRequestIdRef.current) return;

        const resolvedCompany = resolveSupabaseCompany(resolvedProfile, companyRows);
        const memberRows = await onsiteApi.tables.companyMembers.filter({
          company_id: resolvedCompany.id,
          user_id: resolvedProfile.id,
        });
        if (requestId !== pageRequestIdRef.current) return;

        const resolvedMembership = memberRows[0];
        if (!resolvedMembership) {
          throw new Error('Supabase company membership is not available for this user');
        }

        const equipmentRows = await onsiteApi.tables.equipment.filter(
          { company_id: resolvedCompany.id },
          '-created_at'
        );
        if (
          requestId !== pageRequestIdRef.current ||
          equipmentRequestId !== equipmentRequestIdRef.current
        ) {
          return;
        }

        setProfile(resolvedProfile);
        setSupabaseCompany(resolvedCompany);
        setMembership(resolvedMembership);
        setEquipment(equipmentRows);
      } catch (error) {
        if (requestId === pageRequestIdRef.current) {
          console.error('Failed to load Supabase equipment page:', error);
          setProfile(null);
          setSupabaseCompany(null);
          setMembership(null);
          setEquipment([]);
          setLogs([]);
          setLoadError(error?.message || 'Failed to load equipment');
          toast.error('Failed to load equipment');
        }
      } finally {
        if (requestId === pageRequestIdRef.current) {
          setLoading(false);
        }
      }
    };

    loadEquipmentPage();
    return () => {
      pageRequestIdRef.current += 1;
      equipmentRequestIdRef.current += 1;
      logsRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (tab !== 'history') return undefined;

    if (!supabaseCompany?.id) {
      setLogs([]);
      setLogsLoading(false);
      return undefined;
    }

    const requestId = logsRequestIdRef.current + 1;
    logsRequestIdRef.current = requestId;
    setLogsLoading(true);

    const loadLogs = async () => {
      try {
        const rows = await onsiteApi.tables.equipmentLogs.filter(
          { company_id: supabaseCompany.id },
          '-timestamp',
          100
        );
        if (requestId !== logsRequestIdRef.current) return;
        setLogs(rows);
      } catch (error) {
        if (requestId === logsRequestIdRef.current) {
          console.error('Failed to load Supabase equipment history:', error);
          setLogs([]);
          toast.error('Failed to load equipment history');
        }
      } finally {
        if (requestId === logsRequestIdRef.current) {
          setLogsLoading(false);
        }
      }
    };

    loadLogs();
    return () => {
      logsRequestIdRef.current += 1;
    };
  }, [tab, supabaseCompany?.id]);

  const handleCheckout = async (item) => {
    if (!supabaseCompany?.id) {
      toast.error('Supabase company is not ready yet');
      return;
    }

    setActionLoading(item.id);
    try {
      await onsiteApi.tables.equipment.checkout(item.id, supabaseCompany.id);
      toast.success(`${item.name} checked out!`);
      await refreshEquipment();
    } catch (error) {
      console.error('Failed to check out Supabase equipment:', error);
      toast.error('Failed to check out equipment');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReturn = async (item) => {
    if (!supabaseCompany?.id) {
      toast.error('Supabase company is not ready yet');
      return;
    }

    setActionLoading(item.id);
    try {
      await onsiteApi.tables.equipment.returnEquipment(item.id, supabaseCompany.id);
      toast.success(`${item.name} returned!`);
      await refreshEquipment();
    } catch (error) {
      console.error('Failed to return Supabase equipment:', error);
      toast.error('Failed to return equipment');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (item) => {
    if (!isAdmin) return;
    setActionLoading(`delete-${item.id}`);

    try {
      await onsiteApi.tables.equipment.deleteAdmin(item.id);
      setEquipment(currentEquipment => currentEquipment.filter(e => e.id !== item.id));
      toast.success(`${item.name} deleted`);
    } catch (error) {
      console.error('Failed to delete Supabase equipment:', error);
      toast.error('Failed to delete equipment');
    } finally {
      setActionLoading(null);
    }
  };

  const validateSelectedPhoto = (file) => {
    const size = Number(file?.size);
    if (!Number.isFinite(size) || size <= 0) {
      toast.error('Photo file is empty');
      return false;
    }
    if (size > equipmentPhotoMaxBytes) {
      toast.error('Photo must be 20 MB or smaller');
      return false;
    }
    const mimeType = typeof file?.type === 'string' ? file.type.trim() : '';
    if (!equipmentPhotoTypes.has(mimeType)) {
      toast.error('Photo must be JPEG, PNG or WebP');
      return false;
    }
    return true;
  };

  const openPhotoPicker = (item) => {
    if (!isAdmin) return;
    if (photoActionsRef.current[item.id]) return;
    photoTargetRef.current = item;
    if (photoInputRef.current) {
      photoInputRef.current.value = '';
      photoInputRef.current.click();
    }
  };

  const handlePhotoFileChange = async (event) => {
    const file = event.target.files?.[0];
    const item = photoTargetRef.current;
    photoTargetRef.current = null;

    if (event.target) {
      event.target.value = '';
    }
    if (!file || !item) return;
    if (!isAdmin) return;
    if (!supabaseCompany?.id) {
      toast.error('Supabase company is not ready yet');
      return;
    }
    if (!validateSelectedPhoto(file)) return;
    if (!startPhotoAction(item.id, 'replace')) return;

    try {
      const result = await onsiteApi.tables.equipment.replacePhotoAdmin({
        companyId: supabaseCompany.id,
        equipmentId: item.id,
        file,
      });
      equipmentRequestIdRef.current += 1;
      updateEquipmentRow(result.equipment);
      toast.success(item.photo_path ? 'Photo updated' : 'Photo added');
      if (result.cleanup_warning) {
        toast.warning(result.cleanup_warning);
      }
    } catch (error) {
      console.error('Failed to update Supabase equipment photo:', error);
      toast.error('Failed to update equipment photo');
      await refreshEquipment();
    } finally {
      finishPhotoAction(item.id);
    }
  };

  const handleClearPhoto = async (item) => {
    if (!isAdmin || !item?.photo_path) return;
    if (!supabaseCompany?.id) {
      toast.error('Supabase company is not ready yet');
      return;
    }
    if (!startPhotoAction(item.id, 'clear')) return;

    try {
      const result = await onsiteApi.tables.equipment.clearPhotoAdmin({
        companyId: supabaseCompany.id,
        equipmentId: item.id,
      });
      equipmentRequestIdRef.current += 1;
      updateEquipmentRow(result.equipment);
      toast.success('Photo removed');
      if (result.cleanup_warning) {
        toast.warning(result.cleanup_warning);
      }
    } catch (error) {
      console.error('Failed to remove Supabase equipment photo:', error);
      toast.error('Failed to remove equipment photo');
      await refreshEquipment();
    } finally {
      finishPhotoAction(item.id);
    }
  };

  const openEdit = (item) => {
    if (!isAdmin) return;
    setEditItem(item);
    setEditForm({
      name: item.name || '',
      equipment_id: item.equipment_id || '',
      category: item.category || 'tools',
      status: item.status || 'available',
      notes: item.notes || '',
    });
  };

  const handleEditSave = async () => {
    if (!isAdmin || !editItem) return;
    setEditSaving(true);

    try {
      const payload = {
        name: editForm.name,
        equipment_id: editForm.equipment_id,
        category: editForm.category,
        notes: editForm.notes,
      };
      if (editItem.status !== 'checked_out') {
        payload.status = editForm.status;
      }

      const updatedItem = await onsiteApi.tables.equipment.updateAdmin(editItem.id, payload);
      setEquipment(currentEquipment =>
        currentEquipment.map(item => item.id === updatedItem.id ? updatedItem : item)
      );
      toast.success('Equipment updated');
      setEditItem(null);
    } catch (error) {
      console.error('Failed to update Supabase equipment:', error);
      toast.error('Failed to update equipment');
    } finally {
      setEditSaving(false);
    }
  };

  const handleAddSave = async () => {
    if (!isAdmin) return;
    if (!supabaseCompany?.id) {
      toast.error('Supabase company is not ready yet');
      return;
    }
    if (!addForm.name || !addForm.equipment_id) {
      toast.error('Name and Equipment ID are required');
      return;
    }

    setAddSaving(true);
    try {
      const newItem = await onsiteApi.tables.equipment.createAdmin({
        company_id: supabaseCompany.id,
        name: addForm.name,
        equipment_id: addForm.equipment_id,
        category: addForm.category,
        status: addForm.status,
        notes: addForm.notes,
      });
      setEquipment(currentEquipment => [newItem, ...currentEquipment]);
      toast.success(`${addForm.name} added!`);
      setShowAdd(false);
      setAddForm(emptyAddForm);
    } catch (error) {
      console.error('Failed to create Supabase equipment:', error);
      toast.error('Failed to add equipment');
    } finally {
      setAddSaving(false);
    }
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
        {tab === 'equipment' && isAdmin && (
          <button onClick={() => setShowAdd(true)} className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
            <Plus className="w-5 h-5 text-primary-foreground" />
          </button>
        )}
      </div>

      <div className="px-6 mb-4 flex gap-2">
        <button onClick={() => setTab('equipment')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${tab === 'equipment' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
          <Wrench className="w-4 h-4" /> Equipment
        </button>
        <button onClick={() => setTab('history')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${tab === 'history' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
          <History className="w-4 h-4" /> History
        </button>
      </div>

      {tab === 'equipment' && <>
      <div className="px-6 mb-3">
        <div className="flex items-center gap-3 bg-card border border-border rounded-2xl px-4 py-3">
          <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search equipment..."
            className="bg-transparent flex-1 outline-none text-sm placeholder:text-muted-foreground" />
        </div>
      </div>

      <div className="px-6 mb-4 flex gap-2">
        {['all', 'available', 'checked_out', 'maintenance'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-all ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
            {f === 'checked_out' ? 'Out' : f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      </>}

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
                  {editItem.status === 'checked_out' ? (
                    <div className="mt-1">
                      <div className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-muted-foreground">
                        Checked Out
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground/70">Checkout state is controlled by Checkout/Return.</p>
                    </div>
                  ) : (
                    <select value={editForm.status} onChange={e => setEditForm({...editForm, status: e.target.value})}
                      className="mt-1 w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary">
                      <option value="available">Available</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  )}
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

      {showAdd && isAdmin && createPortal(
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

      {isAdmin && (
        <input
          ref={photoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handlePhotoFileChange}
        />
      )}

      {tab === 'history' && (
        <div className="px-6 space-y-3">
          {logsLoading ? (
            Array(5).fill(0).map((_, i) => <div key={i} className="h-16 rounded-2xl bg-card border border-border animate-pulse" />)
          ) : logs.length === 0 ? (
            <div className="text-center py-16">
              <History className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground">No history yet</p>
            </div>
          ) : logs.map(log => (
            <div key={log.id} className="bg-card border border-border rounded-2xl px-4 py-3 flex items-center gap-3">
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

      {tab === 'equipment' && <div className="px-6 space-y-3">
        {loading ? (
          Array(4).fill(0).map((_, i) => <div key={i} className="h-28 rounded-2xl bg-card border border-border animate-pulse" />)
        ) : loadError ? (
          <div className="text-center py-16">
            <Wrench className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">{loadError}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Wrench className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No equipment found</p>
          </div>
        ) : filtered.map(item => {
          const Icon = categoryIcons[item.category] || Package;
          const sc = statusConfig[item.status] || statusConfig.available;
          const isMyCheckout = item.checked_out_by_id === profile?.id;
          const isPhotoBusy = Boolean(photoActions[item.id]);

          return (
            <div key={item.id} className="bg-card border border-border rounded-2xl p-4">
              <div className="flex items-start gap-3">
                <EquipmentPhotoThumbnail companyId={supabaseCompany?.id} item={item} FallbackIcon={Icon} />
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
                      {isAdmin && (
                        <>
                          <button onClick={() => openEdit(item)} className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center hover:bg-primary/20 transition-colors">
                            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            disabled={actionLoading === `delete-${item.id}`}
                            className="w-7 h-7 rounded-lg bg-destructive/10 flex items-center justify-center hover:bg-destructive/20 transition-colors disabled:opacity-60"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-destructive" />
                          </button>
                        </>
                      )}
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
                    {isAdmin && (
                      <>
                        <button
                          onClick={() => openPhotoPicker(item)}
                          disabled={isPhotoBusy}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-secondary text-muted-foreground text-xs font-semibold transition-all active:scale-95 disabled:opacity-60"
                        >
                          <Camera className="w-3.5 h-3.5" />
                          {item.photo_path ? 'Change Photo' : 'Add Photo'}
                        </button>
                        {item.photo_path && (
                          <button
                            onClick={() => handleClearPhoto(item)}
                            disabled={isPhotoBusy}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-secondary text-muted-foreground text-xs font-semibold transition-all active:scale-95 disabled:opacity-60"
                          >
                            <X className="w-3.5 h-3.5" />
                            Remove Photo
                          </button>
                        )}
                      </>
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
