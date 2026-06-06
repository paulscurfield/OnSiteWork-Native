import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function TimesheetEntryDialog({ open, onOpenChange, entry, user, onSuccess }) {
  const [form, setForm] = useState({
    job_id: '', date: '', start_time: '', finish_time: ''
  });
  const [saving, setSaving] = useState(false);

  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs-list'],
    queryFn: () => base44.entities.Job.list(),
  });

  useEffect(() => {
    if (entry) {
      setForm({
        job_id: entry.job_id || '',
        date: entry.date || '',
        start_time: entry.start_time || '',
        finish_time: entry.finish_time || '',
      });
    } else {
      setForm({
        job_id: '',
        date: format(new Date(), 'yyyy-MM-dd'),
        start_time: '',
        finish_time: '',
      });
    }
  }, [entry, open]);

  const handleSave = async () => {
    if (!form.job_id || !form.date || !form.start_time) {
      toast.error('Please fill in job, date, and start time');
      return;
    }
    setSaving(true);
    const selectedJob = jobs.find(j => j.id === form.job_id);
    let totalHours = null;
    if (form.start_time && form.finish_time) {
      const [sh, sm] = form.start_time.split(':').map(Number);
      const [fh, fm] = form.finish_time.split(':').map(Number);
      totalHours = Math.round(((fh * 60 + fm) - (sh * 60 + sm)) / 60 * 100) / 100;
    }

    const data = {
      worker_email: user.email,
      worker_name: user.full_name,
      job_id: form.job_id,
      job_name: selectedJob?.job_name || '',
      job_number: selectedJob?.job_number || '',
      date: form.date,
      start_time: form.start_time,
      finish_time: form.finish_time || undefined,
      total_hours: totalHours,
      status: form.finish_time ? 'manual' : 'clocked_in',
    };

    if (entry) {
      await base44.entities.TimeEntry.update(entry.id, data);
      toast.success('Entry updated');
    } else {
      await base44.entities.TimeEntry.create(data);
      toast.success('Entry added');
    }
    setSaving(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{entry ? 'Edit Time Entry' : 'Add Time Entry'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Job Site *</Label>
            <Select value={form.job_id} onValueChange={v => setForm({ ...form, job_id: v })}>
              <SelectTrigger><SelectValue placeholder="Select a job" /></SelectTrigger>
              <SelectContent>
                {jobs.map(j => (
                  <SelectItem key={j.id} value={j.id}>{j.job_name} (#{j.job_number})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Date *</Label>
            <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Start Time *</Label>
              <Input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Finish Time</Label>
              <Input type="time" value={form.finish_time} onChange={e => setForm({ ...form, finish_time: e.target.value })} />
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {entry ? 'Update Entry' : 'Add Entry'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}