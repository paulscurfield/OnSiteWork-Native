import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { User, Phone, Mail, Shield, Save, ChevronLeft, Camera, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

export default function Profile() {
  const [user, setUser] = useState(null);
  const [form, setForm] = useState({ full_name: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef(null);

  useEffect(() => {
    base44.auth.me().then(u => {
      setUser(u);
      setForm({
        full_name: u.full_name || '',
        phone: u.phone || '',
      });
    }).catch(() => {});
  }, []);

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    const { file_url } = await base44.integrations.Core.UploadFile({ file });
    await base44.auth.updateMe({ avatar_url: file_url });
    setUser(u => ({ ...u, avatar_url: file_url }));
    toast.success('Profile photo updated!');
    setUploadingAvatar(false);
    e.target.value = '';
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await base44.auth.updateMe({
        full_name: form.full_name,
        phone: form.phone,
      });
      toast.success('Profile updated!');
    } catch (e) {
      toast.error('Failed to save. Please try again.');
    }
    setSaving(false);
  };

  const roleColors = {
    admin: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    supervisor: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    user: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    worker: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-black">My Profile</h1>
      </div>

      <div className="px-6">
        {/* Avatar */}
        <div className="flex flex-col items-center py-8">
          <button onClick={() => avatarInputRef.current?.click()} disabled={uploadingAvatar}
            className="relative w-24 h-24 rounded-full mb-4 group">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt="avatar"
                className="w-24 h-24 rounded-full object-cover border-2 border-primary/40" />
            ) : (
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 border-2 border-primary/40 flex items-center justify-center">
                <span className="text-3xl font-black text-primary">
                  {user?.full_name?.charAt(0)?.toUpperCase() || '?'}
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
          <h2 className="text-xl font-bold">{form.full_name || user?.full_name || 'Loading...'}</h2>
          <span className={`mt-2 px-3 py-1 rounded-full text-xs font-semibold border ${roleColors[user?.role] || roleColors.worker}`}>
            {(user?.role || 'worker').toUpperCase()}
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
                <p className="font-semibold capitalize">{user?.role || 'worker'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full mt-6 mb-4 py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-base flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-60"
        >
          <Save className="w-5 h-5" />
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </div>
  );
}