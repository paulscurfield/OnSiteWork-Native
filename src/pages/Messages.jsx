import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';
import { onsiteApi } from '@/api/supabase/adapter';
import { useCompany } from '@/lib/companyContext';
import { Link } from 'react-router-dom';
import { ChevronLeft, MessageSquare, Send, X, Plus, Mail, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const workerDisplayName = (worker = {}) => worker.display_name || worker.full_name || worker.email || '';

export default function Messages() {
  const { company } = useCompany();
  const directoryRequestIdRef = useRef(0);
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [showCompose, setShowCompose] = useState(false);
  const [activeTab, setActiveTab] = useState('inbox');
  const [form, setForm] = useState({ recipient_email: '', recipient_name: '', subject: '', body: '', message_type: 'direct' });

  useEffect(() => {
    base44.auth.me().then(setUser).catch(() => {});
    loadRecipientDirectory();

    return () => {
      directoryRequestIdRef.current += 1;
    };
  }, []);

  const loadRecipientDirectory = async () => {
    const requestId = directoryRequestIdRef.current + 1;
    directoryRequestIdRef.current = requestId;
    setDirectoryLoading(true);
    setDirectoryError('');

    try {
      await onsiteApi.auth.me();
      const companies = await onsiteApi.tables.companies.list('name');
      if (companies.length === 0) {
        throw new Error('No Supabase company found for recipient directory');
      }
      if (companies.length > 1) {
        throw new Error('Multiple Supabase companies found for recipient directory');
      }

      const directory = await onsiteApi.tables.companyMembers.directory(companies[0].id);
      const recipients = directory
        .filter(worker => normalizeEmail(worker.email))
        .map(worker => ({
          ...worker,
          id: worker.user_id || worker.email,
          email: worker.email,
          display_name: workerDisplayName(worker),
        }));

      if (directoryRequestIdRef.current !== requestId) return;
      setUsers(recipients);
      setForm(current => {
        if (
          current.message_type !== 'direct' ||
          !current.recipient_email ||
          recipients.some(worker => normalizeEmail(worker.email) === normalizeEmail(current.recipient_email))
        ) {
          return current;
        }
        return { ...current, recipient_email: '', recipient_name: '' };
      });
    } catch (error) {
      console.error('Failed to load message recipient directory', error);
      if (directoryRequestIdRef.current !== requestId) return;
      setUsers([]);
      setDirectoryError('Recipients unavailable');
      setForm(current => (
        current.message_type === 'direct'
          ? { ...current, recipient_email: '', recipient_name: '' }
          : current
      ));
    } finally {
      if (directoryRequestIdRef.current === requestId) {
        setDirectoryLoading(false);
      }
    }
  };

  const loadMessages = async () => {
    const all = await base44.entities.Message.filter({ company_id: company?.id }, '-created_date');
    setMessages(all);
    return all;
  };

  // Load messages and auto-mark all unread inbox items as read
  useEffect(() => {
    if (!user) return;
    loadMessages().then(all => {
      const unread = all.filter(m =>
        (m.recipient_email === user.email || m.recipient_email === 'all') && !m.is_read
      );
      unread.forEach(m => base44.entities.Message.update(m.id, { is_read: true }).catch(() => {}));
      if (unread.length > 0) loadMessages(); // refresh to show updated read state
    });
  }, [user]);

  const inbox = messages.filter(m => m.recipient_email === user?.email || m.recipient_email === 'all');
  const sent = messages.filter(m => m.sender_email === user?.email);
  const selectedRecipient = users.find(u => normalizeEmail(u.email) === normalizeEmail(form.recipient_email));
  const hasValidDirectRecipient = Boolean(
    selectedRecipient &&
    normalizeEmail(selectedRecipient.email) &&
    normalizeEmail(selectedRecipient.email) !== normalizeEmail(user?.email)
  );
  const hasMessageBody = Boolean(form.body.trim());
  const canSend = hasMessageBody && (form.message_type === 'broadcast' || hasValidDirectRecipient);

  const handleSend = async () => {
    if (!hasMessageBody) return;
    if (form.message_type === 'direct' && !hasValidDirectRecipient) {
      toast.error('Select a recipient');
      return;
    }
    await base44.entities.Message.create({
      company_id: company?.id,
      sender_email: user.email,
      sender_name: user.full_name,
      recipient_email: form.message_type === 'broadcast' ? 'all' : form.recipient_email,
      recipient_name: form.message_type === 'broadcast' ? 'All Workers' : workerDisplayName(selectedRecipient),
      subject: form.subject,
      body: form.body.trim(),
      message_type: form.message_type,
    });
    setShowCompose(false);
    setForm({ recipient_email: '', recipient_name: '', subject: '', body: '', message_type: 'direct' });
    loadMessages();
  };

  const markRead = async (msg) => {
    if (!msg.is_read && msg.recipient_email === user?.email) {
      await base44.entities.Message.update(msg.id, { is_read: true });
      loadMessages();
    }
  };

  const displayList = activeTab === 'inbox' ? inbox : sent;

  return (
    <div className="min-h-screen bg-background">
      <div className="px-6 pt-14 pb-4 flex items-center gap-4">
        <Link to="/" className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-2xl font-black flex-1">Messages</h1>
        <button onClick={() => setShowCompose(true)} className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
          <Plus className="w-4 h-4 text-primary-foreground" />
        </button>
      </div>

      {/* Tabs */}
      <div className="px-6 mb-4">
        <div className="flex bg-card border border-border rounded-2xl p-1">
          {['inbox', 'sent'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 rounded-xl text-sm font-semibold capitalize transition-all ${activeTab === tab ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}>
              {tab}
              {tab === 'inbox' && inbox.filter(m => !m.is_read).length > 0 && (
                <span className="ml-1.5 bg-destructive text-destructive-foreground text-xs px-1.5 py-0.5 rounded-full">
                  {inbox.filter(m => !m.is_read).length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Message List */}
      <div className="px-6 space-y-3">
        {displayList.length === 0 ? (
          <div className="text-center py-16">
            <MessageSquare className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No messages</p>
          </div>
        ) : displayList.map(msg => (
          <div key={msg.id} onClick={() => markRead(msg)}
            className={`bg-card border rounded-2xl p-4 cursor-pointer transition-all active:scale-95 ${!msg.is_read && msg.recipient_email === user?.email ? 'border-primary/30 bg-primary/5' : 'border-border'}`}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <span className="font-bold text-sm">
                  {(activeTab === 'inbox' ? msg.sender_name : msg.recipient_name)?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <p className={`font-semibold text-sm truncate ${!msg.is_read && msg.recipient_email === user?.email ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {activeTab === 'inbox' ? msg.sender_name : `To: ${msg.recipient_name}`}
                  </p>
                  <p className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                    {msg.created_date ? format(parseISO(msg.created_date), 'MMM d') : ''}
                  </p>
                </div>
                {msg.subject && <p className="text-sm font-medium text-foreground truncate">{msg.subject}</p>}
                <p className="text-xs text-muted-foreground truncate mt-0.5">{msg.body}</p>
              </div>
              {!msg.is_read && msg.recipient_email === user?.email && (
                <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Compose Modal */}
      {showCompose && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-card border-t border-border rounded-t-3xl p-6 pb-8">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-black">New Message</h3>
              <button onClick={() => setShowCompose(false)} className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Type Toggle */}
            <div className="flex bg-muted rounded-xl p-1 mb-4">
              <button onClick={() => setForm(f => ({ ...f, message_type: 'direct' }))}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${form.message_type === 'direct' ? 'bg-card shadow text-foreground' : 'text-muted-foreground'}`}>
                <Mail className="w-4 h-4" /> Direct
              </button>
              <button onClick={() => setForm(f => ({ ...f, message_type: 'broadcast', recipient_email: 'all', recipient_name: 'All Workers' }))}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${form.message_type === 'broadcast' ? 'bg-card shadow text-foreground' : 'text-muted-foreground'}`}>
                <Users className="w-4 h-4" /> Broadcast
              </button>
            </div>

            <div className="space-y-3">
              {form.message_type === 'direct' && (
                <select value={form.recipient_email}
                  disabled={directoryLoading || Boolean(directoryError) || users.filter(u => normalizeEmail(u.email) !== normalizeEmail(user?.email)).length === 0}
                  onChange={e => {
                    const u = users.find(u => normalizeEmail(u.email) === normalizeEmail(e.target.value));
                    setForm(f => ({ ...f, recipient_email: e.target.value, recipient_name: workerDisplayName(u) }));
                  }}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground outline-none">
                  {directoryLoading ? (
                    <option value="">Loading recipients...</option>
                  ) : directoryError ? (
                    <option value="">Recipients unavailable</option>
                  ) : users.filter(u => normalizeEmail(u.email) !== normalizeEmail(user?.email)).length === 0 ? (
                    <option value="">No other workers available</option>
                  ) : (
                    <>
                      <option value="">Select recipient...</option>
                      {users.filter(u => normalizeEmail(u.email) !== normalizeEmail(user?.email)).map(u => (
                        <option key={u.id} value={u.email} className="bg-card">{workerDisplayName(u)} ({u.email})</option>
                      ))}
                    </>
                  )}
                </select>
              )}
              <input value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                placeholder="Subject (optional)"
                className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground/50" />
              <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                placeholder="Write your message..."
                rows={4}
                className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground outline-none placeholder:text-muted-foreground/50 resize-none" />
            </div>

            <button onClick={handleSend} disabled={!canSend}
              className="w-full mt-4 py-4 rounded-2xl bg-primary text-primary-foreground font-bold flex items-center justify-center gap-2 disabled:opacity-60">
              <Send className="w-5 h-5" />
              Send Message
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
