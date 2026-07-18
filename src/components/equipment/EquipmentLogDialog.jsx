import React from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, ArrowRightLeft, CheckCircle } from 'lucide-react';
import { format } from 'date-fns';

export default function EquipmentLogDialog({ open, onOpenChange, equipment }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['equipment-log', equipment?.id],
    queryFn: () => base44.entities.EquipmentLog.filter({ equipment_id: equipment.id }, '-created_date'),
    enabled: !!equipment?.id && open,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Activity Log – {equipment?.name}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No activity recorded yet</p>
        ) : (
          <div className="space-y-3">
            {logs.map(log => (
              <div key={log.id} className="flex items-start gap-3 text-sm">
                <div className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                  log.action === 'checked_out' ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'
                }`}>
                  {log.action === 'checked_out' ? <ArrowRightLeft className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
                </div>
                <div className="flex-1">
                  <p>
                    <strong>{log.worker_name}</strong>{' '}
                    {log.action === 'checked_out' ? 'checked out' : 'returned'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {log.timestamp && format(new Date(log.timestamp), 'PPpp')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}