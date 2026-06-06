import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

export default function JobFormDialog({ open, onOpenChange, job, onSuccess }) {
  const [form, setForm] = useState({
    job_name: '', job_number: '', location_address: '',
    location_lat: '', location_lng: '', notes: '', status: 'active'
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (job) {
      setForm({
        job_name: job.job_name || '',
        job_number: job.job_number || '',
        location_address: job.location_address || '',
        location_lat: job.location_lat || '',
        location_lng: job.location_lng || '',
        notes: job.notes || '',
        status: job.status || 'active',
      });
    } else {
      setForm({ job_name: '', job_number: '', location_address: '', location_lat: '', location_lng: '', notes: '', status: 'active' });
    }
  }, [job, open]);

  const handleSave = async () => {
    if (!form.job_name || !form.job_number) {
      toast.error('Job name and number are required');
      return;
    }
    setSaving(true);
    const data = {
      ...form,
      location_lat: form.location_lat ? parseFloat(form.location_lat) : undefined,
      location_lng: form.location_lng ? parseFloat(form.location_lng) : undefined,
    };
    if (job) {
      await base44.entities.Job.update(job.id, data);
      toast.success('Job updated');
    } else {
      await base44.entities.Job.create(data);
      toast.success('Job created');
    }
    setSaving(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{job ? 'Edit Job' : 'New Job Site'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Job Name *</Label>
            <Input value={form.job_name} onChange={e => setForm({ ...form, job_name: e.target.value })} placeholder="e.g. Smith Residence" />
          </div>
          <div className="space-y-2">
            <Label>Job Number *</Label>
            <Input value={form.job_number} onChange={e => setForm({ ...form, job_number: e.target.value })} placeholder="e.g. JOB-001" />
          </div>
          <div className="space-y-2">
            <Label>Address</Label>
            <Input value={form.location_address} onChange={e => setForm({ ...form, location_address: e.target.value })} placeholder="123 Main St..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Latitude</Label>
              <Input value={form.location_lat} onChange={e => setForm({ ...form, location_lat: e.target.value })} placeholder="-33.8688" />
            </div>
            <div className="space-y-2">
              <Label>Longitude</Label>
              <Input value={form.location_lng} onChange={e => setForm({ ...form, location_lng: e.target.value })} placeholder="151.2093" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Additional info..." rows={3} />
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {job ? 'Update Job' : 'Create Job'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}