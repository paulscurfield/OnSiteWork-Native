import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Send } from 'lucide-react';
import { toast } from 'sonner';

export default function ComposeMessageDialog({ open, onOpenChange, currentUser, onSuccess }) {
  const [form, setForm] = useState({ to_email: '', subject: '', body: '' });
  const [sending, setSending] = useState(false);

  const { data: users = [] } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => base44.entities.User.list(),
  });

  const handleSend = async () => {
    if (!form.to_email || !form.subject || !form.body) {
      toast.error('Please fill in all fields');
      return;
    }
    setSending(true);
    const recipient = users.find(u => u.email === form.to_email);
    await base44.entities.Message.create({
      from_email: currentUser.email,
      from_name: currentUser.full_name,
      to_email: form.to_email,
      to_name: recipient?.full_name || form.to_email,
      subject: form.subject,
      body: form.body,
      read: false,
    });
    toast.success('Message sent!');
    setForm({ to_email: '', subject: '', body: '' });
    setSending(false);
    onSuccess();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Message</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>To</Label>
            <Select value={form.to_email} onValueChange={v => setForm({ ...form, to_email: v })}>
              <SelectTrigger><SelectValue placeholder="Select recipient" /></SelectTrigger>
              <SelectContent>
                {users.filter(u => u.email !== currentUser?.email).map(u => (
                  <SelectItem key={u.id} value={u.email}>{u.full_name || u.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Subject</Label>
            <Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="Message subject" />
          </div>
          <div className="space-y-2">
            <Label>Message</Label>
            <Textarea value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} placeholder="Type your message..." rows={5} />
          </div>
          <Button onClick={handleSend} disabled={sending} className="w-full">
            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
            Send Message
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}