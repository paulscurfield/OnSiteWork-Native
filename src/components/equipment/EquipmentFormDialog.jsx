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

export default function EquipmentFormDialog({ open, onOpenChange, equipment, onSuccess }) {
  const [form, setForm] = useState({
    name: '', equipment_id: '', category: 'other', status: 'available', notes: ''
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (equipment) {
      setForm({
        name: equipment.name || '',
        equipment_id: equipment.equipment_id || '',
        category: equipment.category || 'other',
        status: equipment.status || 'available',
        notes: equipment.notes || '',
      });
    } else {
      setForm({ name: '', equipment_id: '', category: 'other', status: 'available', notes: '' });
    }
  }, [equipment, open]);

  const handleSave = async () => {
    if (!form.name || !form.equipment_id) {
      toast.error('Name and ID are required');
      return;
    }
    setSaving(true);
    if (equipment) {
      await base44.entities.Equipment.update(equipment.id, form);
      toast.success('Equipment updated');
    } else {
      await base44.entities.Equipment.create(form);
      toast.success('Equipment added');
    }
    setSaving(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{equipment ? 'Edit Equipment' : 'Add Equipment'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Hilti Drill" />
          </div>
          <div className="space-y-2">
            <Label>Equipment ID *</Label>
            <Input value={form.equipment_id} onChange={e => setForm({ ...form, equipment_id: e.target.value })} placeholder="e.g. EQ-001" />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hand_tool">Hand Tool</SelectItem>
                <SelectItem value="power_tool">Power Tool</SelectItem>
                <SelectItem value="heavy_machinery">Heavy Machinery</SelectItem>
                <SelectItem value="vehicle">Vehicle</SelectItem>
                <SelectItem value="safety">Safety</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Additional details..." rows={3} />
          </div>
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            {equipment ? 'Update' : 'Add Equipment'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}