import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Building2, ArrowRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function Onboarding({ onComplete }) {
  const [form, setForm] = useState({ name: '', industry: '', phone: '', address: '' });
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!form.name.trim()) { toast.error('Company name is required'); return; }
    setSaving(true);
    const user = await base44.auth.me();
    const slug = form.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    const company = await base44.entities.Company.create({
      name: form.name.trim(),
      slug,
      owner_email: user.email,
      industry: form.industry,
      phone: form.phone,
      address: form.address,
      subscription_status: 'trial',
    });
    await base44.auth.updateMe({ company_id: company.id });
    toast.success(`Welcome to OnSite — ${form.name} is ready!`);
    setSaving(false);
    onComplete(company);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ backgroundColor: '#080808' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <img src="https://media.base44.com/images/public/69ed2e38df2868964a60dd25/75e0af5f7_generated_image.png"
            alt="logo" className="w-16 h-16 object-contain mx-auto mb-4" />
          <h1 className="text-3xl font-black tracking-tight">
            <span style={{ color: '#10B981' }}>ONSITE</span>{' '}
            <span className="text-white">Timesheet</span>
          </h1>
          <p className="text-gray-400 text-sm mt-2">Let's set up your company</p>
        </div>

        {/* Form */}
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
              Company Name *
            </label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Elite Turf Projects"
              className="w-full rounded-2xl px-4 py-3.5 text-white font-semibold outline-none text-sm"
              style={{ backgroundColor: '#111', border: '2px solid #10B981' }}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
              Industry
            </label>
            <input
              value={form.industry}
              onChange={e => setForm(f => ({ ...f, industry: e.target.value }))}
              placeholder="e.g. Landscaping, Construction"
              className="w-full rounded-2xl px-4 py-3.5 text-white font-semibold outline-none text-sm"
              style={{ backgroundColor: '#111', border: '1px solid #333' }}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
              Phone
            </label>
            <input
              value={form.phone}
              onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="+61 400 000 000"
              className="w-full rounded-2xl px-4 py-3.5 text-white font-semibold outline-none text-sm"
              style={{ backgroundColor: '#111', border: '1px solid #333' }}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider block mb-1.5">
              Address
            </label>
            <input
              value={form.address}
              onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Company address"
              className="w-full rounded-2xl px-4 py-3.5 text-white font-semibold outline-none text-sm"
              style={{ backgroundColor: '#111', border: '1px solid #333' }}
            />
          </div>
        </div>

        <button
          onClick={handleCreate}
          disabled={saving}
          className="w-full mt-8 py-4 rounded-2xl font-black text-lg flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-60"
          style={{ backgroundColor: '#10B981', color: '#000' }}
        >
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
          {saving ? 'Setting up...' : 'Create My Company'}
        </button>

        <p className="text-center text-gray-600 text-xs mt-4">
          You'll be the admin. Invite workers after setup.
        </p>
      </div>
    </div>
  );
}