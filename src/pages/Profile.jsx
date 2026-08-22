import { useState, useEffect, useRef } from 'react';
import { onsiteApi } from '@/api/supabase/adapter';
import { User, Phone, Mail, Shield, Save, ChevronLeft, Camera, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const resolveSupabaseCompany = (profile, companyRows) => {
  if (!profile?.id) {
    throw new Error('You must be signed in to view your profile.');
  }
  if (!Array.isArray(companyRows) || companyRows.length === 0) {
    throw new Error('No Supabase company is available for this profile.');
  }
  if (companyRows.length > 1) {
    throw new Error('Multiple Supabase companies are available. Profile cannot choose one safely.');
  }
  return companyRows[0];
};

export default function Profile() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [form, setForm] = useState({ full_name: '', phone: '' });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef(null);
  const mountedRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const avatarRequestIdRef = useRef(0);
  const uploadingAvatarRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;

    const loadProfile = async () => {
      setLoading(true);
      setLoadError('');
      setUser(null);
      setRole(null);
      setAvatarUrl(null);
      setForm({ full_name: '', phone: '' });

      try {
        const [profile, companies] = await Promise.all([
          onsiteApi.auth.me(),
          onsiteApi.tables.companies.list('name'),
        ]);
        if (!mountedRef.current || requestId !== loadRequestIdRef.current) return;

        const company = resolveSupabaseCompany(profile, companies);
        const memberships = await onsiteApi.tables.companyMembers.filter({
          company_id: company.id,
          user_id: profile.id,
        });
        if (!mountedRef.current || requestId !== loadRequestIdRef.current) return;

        if (!Array.isArray(memberships) || memberships.length !== 1) {
          throw new Error('Profile membership could not be resolved safely.');
        }

        setUser(profile);
        setRole(memberships[0].role);
        setForm({
          full_name: profile.full_name || '',
          phone: profile.phone || '',
        });

        const avatarPath = profile.avatar_path;
        if (avatarPath) {
          const avatarRequestId = avatarRequestIdRef.current + 1;
          avatarRequestIdRef.current = avatarRequestId;
          onsiteApi.auth.getMyAvatarSignedUrl(avatarPath)
            .then((signedUrl) => {
              if (
                mountedRef.current &&
                requestId === loadRequestIdRef.current &&
                avatarRequestId === avatarRequestIdRef.current
              ) {
                setAvatarUrl(signedUrl);
              }
            })
            .catch((error) => {
              console.warn('Profile avatar preview could not be loaded', error);
              if (
                mountedRef.current &&
                requestId === loadRequestIdRef.current &&
                avatarRequestId === avatarRequestIdRef.current
              ) {
                setAvatarUrl(null);
              }
            });
        }
      } catch (error) {
        console.warn('Profile could not be loaded', error);
        if (mountedRef.current && requestId === loadRequestIdRef.current) {
          setLoadError(error?.message || 'Profile is unavailable.');
          setUser(null);
          setRole(null);
          setAvatarUrl(null);
        }
      } finally {
        if (mountedRef.current && requestId === loadRequestIdRef.current) {
          setLoading(false);
        }
      }
    };

    loadProfile();

    return () => {
      mountedRef.current = false;
      loadRequestIdRef.current += 1;
      avatarRequestIdRef.current += 1;
    };
  }, []);

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (uploadingAvatarRef.current || loading || loadError || !user) {
      e.target.value = '';
      return;
    }

    uploadingAvatarRef.current = true;
    setUploadingAvatar(true);
    const avatarRequestId = avatarRequestIdRef.current + 1;
    avatarRequestIdRef.current = avatarRequestId;

    try {
      const updatedProfile = await onsiteApi.auth.replaceMyAvatar(file);
      if (mountedRef.current) {
        setUser(updatedProfile);
        try {
          const signedUrl = await onsiteApi.auth.getMyAvatarSignedUrl(updatedProfile.avatar_path);
          if (mountedRef.current && avatarRequestId === avatarRequestIdRef.current) {
            setAvatarUrl(signedUrl);
            toast.success('Profile photo updated!');
          }
        } catch (signError) {
          console.warn('Profile avatar preview could not be refreshed', signError);
          if (mountedRef.current && avatarRequestId === avatarRequestIdRef.current) {
            setAvatarUrl(null);
            toast.success('Profile photo updated, but preview could not refresh.');
          }
        }
      }
    } catch (error) {
      console.warn('Profile photo update failed', error);
      if (mountedRef.current) {
        toast.error(error?.message || 'Failed to update profile photo');
      }
    } finally {
      uploadingAvatarRef.current = false;
      if (mountedRef.current) {
        setUploadingAvatar(false);
      }
      e.target.value = '';
    }
  };

  const handleSave = async () => {
    if (!user || loadError || saving) return;
    setSaving(true);
    try {
      const updatedProfile = await onsiteApi.auth.updateMyProfile({
        full_name: form.full_name,
        phone: form.phone,
      });
      setUser(updatedProfile);
      setForm({
        full_name: updatedProfile.full_name || '',
        phone: updatedProfile.phone || '',
      });
      toast.success('Profile updated!');
    } catch (e) {
      toast.error('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const roleColors = {
    owner: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    admin: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    supervisor: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    user: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    worker: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  };
  const displayedRole = role || 'worker';
  const profileDisabled = loading || !!loadError || !user;

  return (
    <div className="min-h-screen bg-background">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-black">My Profile</h1>
      </div>

      <div className="px-6">
        {loadError && (
          <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {loadError}
          </div>
        )}

        {/* Avatar */}
        <div className="flex flex-col items-center py-8">
          <button onClick={() => avatarInputRef.current?.click()} disabled={profileDisabled || uploadingAvatar}
            className="relative w-24 h-24 rounded-full mb-4 group">
            {avatarUrl ? (
              <img src={avatarUrl} alt="avatar"
                className="w-24 h-24 rounded-full object-cover border-2 border-primary/40" />
            ) : (
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-primary/40 flex items-center justify-center">
                <span className="text-3xl font-black text-primary">
                  {(form.full_name || user?.full_name)?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
            )}
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity">
              {uploadingAvatar
                ? <Loader2 className="w-6 h-6 text-white animate-spin" />
                : <Camera className="w-6 h-6 text-white" />}
            </div>
          </button>
          <input ref={avatarInputRef} type="file" accept="image/*" onChange={handleAvatarChange} className="hidden" />
          <p className="text-xs text-muted-foreground mb-2">Tap to change photo</p>
          <h2 className="text-xl font-bold">{form.full_name || user?.full_name || (loading ? 'Loading...' : '—')}</h2>
          <span className={`mt-2 px-3 py-1 rounded-full text-xs font-semibold border ${roleColors[displayedRole] || roleColors.worker}`}>
            {displayedRole.toUpperCase()}
          </span>
        </div>

        {/* Fields */}
        <div className="space-y-4">
          {/* Name (editable) */}
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">Full Name</p>
                <input
                  value={form.full_name}
                  onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  disabled={profileDisabled}
                  placeholder="Enter your name"
                  className="bg-transparent font-semibold w-full outline-none placeholder:text-muted-foreground/50"
                />
              </div>
            </div>
          </div>

          {/* Email (read-only) */}
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                <Mail className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">Email</p>
                <p className="font-semibold">{user?.email || '—'}</p>
              </div>
            </div>
          </div>

          {/* Phone */}
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                <Phone className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">Phone</p>
                <input
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  disabled={profileDisabled}
                  placeholder="+1 555 000 0000"
                  className="bg-transparent font-semibold w-full outline-none placeholder:text-muted-foreground/50"
                />
              </div>
            </div>
          </div>

          {/* Role (read-only) */}
          <div className="bg-card rounded-2xl border border-border p-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center">
                <Shield className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground mb-1">Role</p>
                <p className="font-semibold capitalize">{displayedRole}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={profileDisabled || saving}
          className="w-full mt-6 mb-4 py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-60"
        >
          <Save className="w-5 h-5" />
          {saving ? 'Saving...' : loading ? 'Loading...' : 'Save Profile'}
        </button>
      </div>
    </div>
  );
}
