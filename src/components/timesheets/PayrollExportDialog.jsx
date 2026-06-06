import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Download, FileSpreadsheet } from 'lucide-react';
import { format, parseISO, startOfWeek, endOfWeek } from 'date-fns';
import { toast } from 'sonner';

export default function PayrollExportDialog({ open, onOpenChange, entries }) {
  const [dateFrom, setDateFrom] = useState(format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd'));

  const handleExport = () => {
    const filtered = entries.filter(e => {
      if (!e.date) return false;
      return e.date >= dateFrom && e.date <= dateTo;
    });

    if (filtered.length === 0) {
      toast.error('No entries found for this date range');
      return;
    }

    const headers = ['Worker Name', 'Job Site', 'Job Number', 'Date', 'Start Time', 'Finish Time', 'Total Hours'];
    const rows = filtered.map(e => [
      e.worker_name || '',
      e.job_name || '',
      e.job_number || '',
      e.date || '',
      e.start_time || '',
      e.finish_time || '',
      e.total_hours || '',
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll_${dateFrom}_to_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} entries`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5" /> Export Payroll CSV
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>From Date</Label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>To Date</Label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          <Button onClick={handleExport} className="w-full">
            <Download className="w-4 h-4 mr-2" /> Download CSV
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}