import { useState, useEffect, useRef } from 'react';
import { onsiteApi } from '@/api/supabase/adapter';
import { Link } from 'react-router-dom';
import { ChevronLeft, MessageSquare, Send, X, Plus, Mail, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const workerDisplayName = (worker = {}) => worker.display_name || worker.full_name || worker.email || '';

export default function Messages() {
  const mountedRef = useRef(false);
  const loadRequestIdRef = useRef(0);
  const directoryRequestIdRef = useRef(0);
  const sendingRef = useRef(false);
  const [user, setUser] = useState(null);
  const [supabaseCompany, setSupabaseCompany] = useState(null);
  const [messages, setMessages] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [sending, setSending] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [activeTab, setActiveTab] = useState('inbox');
  const [form, setForm] = useState({ recipient_id: '', recipient_name: '', subject: '', body: '', message_type: 'direct' });

  useEffect(() => {
    mountedRef.current = true;
    initializeMessagesPage();

    return () => {
      mountedRef.current = false;
      loadRequestIdRef.current += 1;
      directoryRequestIdRef.current += 1;
    };
  }, []);

  const isCurrentLoad = (requestId) => mountedRef.current && loadRequestIdRef.current === requestId;

  const resetComposeForm = () => {
    setForm({ recipient_id: '', recipient_name: '', subject: '', body: '', message_type: 'direct' });
  };

  const resolveContext = async () => {
    const [profile, companies] = await Promise.all([
      onsiteApi.auth.me(),
      onsiteApi.tables.companies.list('name'),
    ]);

    if (!profile?.id) {
      throw new Error('Sign in to view Messages.');
    }
    if (companies.length === 0) {
      throw new Error('Messages unavailable: no Supabase company found.');
    }
    if (companies.length > 1) {
      throw new Error('Messages unavailable: company selection is required.');
    }

    return { profile, company: companies[0] };
  };

  const isInboxMessage = (message, profileId = user?.id) => (
    message.message_type === 'broadcast' || message.recipient_id === profileId
  );

  const isUnreadInboxMessage = (message, profileId = user?.id) => (
    isInboxMessage(message, profileId) && !message.is_read
  );

  const loadMailbox = async (companyId, profileId, requestId, { autoMark = false } = {}) => {
    const mailbox = await onsiteApi.tables.messages.mailbox(companyId);
    if (!isCurrentLoad(requestId)) return null;
    setMessages(mailbox);

    if (!autoMark) return mailbox;

    const unreadInbox = mailbox.filter(message => isUnreadInboxMessage(message, profileId));
    if (unreadInbox.length === 0) return mailbox;

    const results = await Promise.allSettled(
      unreadInbox.map(message =>
        onsiteApi.tables.messages.markRead(message.id, { company_id: companyId })
      )
    );
    results
      .filter(result => result.status === 'rejected')
      .forEach(result => console.error('Failed to mark message read:', result.reason));

    if (!isCurrentLoad(requestId)) return null;
    if (results.some(result => result.status === 'fulfilled')) {
      try {
        const refreshedMailbox = await onsiteApi.tables.messages.mailbox(companyId);
        if (!isCurrentLoad(requestId)) return null;
        setMessages(refreshedMailbox);
        return refreshedMailbox;
      } catch (error) {
        console.error('Failed to refresh messages after marking read:', error);
      }
    }

    return mailbox;
  };

  const initializeMessagesPage = async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setLoading(true);
    setLoadError('');
    setMessages([]);
    setUsers([]);
    setDirectoryError('');
    setUser(null);
    setSupabaseCompany(null);

    try {
      const { profile, company } = await resolveContext();
      if (!isCurrentLoad(requestId)) return;

      setUser(profile);
      setSupabaseCompany(company);

      await loadMailbox(company.id, profile.id, requestId, { autoMark: true });
      if (!isCurrentLoad(requestId)) return;
      setLoading(false);
      loadRecipientDirectory(company, profile);
    } catch (error) {
      console.error('Failed to load Supabase Messages:', error);
      if (!isCurrentLoad(requestId)) return;
      setMessages([]);
      setUsers([]);
      setLoadError(error.message || 'Messages unavailable');
      setLoading(false);
    }
  };

  const loadRecipientDirectory = async (company = supabaseCompany, profile = user) => {
    if (!company || !company.id || !profile || !profile.id) return;
    const requestId = directoryRequestIdRef.current + 1;
    directoryRequestIdRef.current = requestId;
    setDirectoryLoading(true);
    setDirectoryError('');

    try {
      const directory = await onsiteApi.tables.companyMembers.directory(company.id);
      const recipients = directory
        .filter(worker => worker.user_id && worker.user_id !== profile.id && normalizeEmail(worker.email))
        .map(worker => ({
          ...worker,
          id: worker.user_id,
          email: worker.email,
          display_name: workerDisplayName(worker),
        }));

      if (!mountedRef.current || directoryRequestIdRef.current !== requestId) return;
      setUsers(recipients);
      setForm(current => {
        if (
          current.message_type !== 'direct' ||
          !current.recipient_id ||
          recipients.some(worker => worker.user_id === current.recipient_id)
        ) {
          return current;
        }
        return { ...current, recipient_id: '', recipient_name: '' };
      });
    } catch (error) {
      console.error('Failed to load message recipient directory', error);
      if (!mountedRef.current || directoryRequestIdRef.current !== requestId) return;
      setUsers([]);
      setDirectoryError('Recipients unavailable');
      setForm(current => (
        current.message_type === 'direct'
          ? { ...current, recipient_id: '', recipient_name: '' }
          : current
      ));
    } finally {
      if (mountedRef.current && directoryRequestIdRef.current === requestId) {
        setDirectoryLoading(false);
      }
    }
  };

  const refreshMailbox = async () => {
    if (!supabaseCompany?.id || !user?.id) return;
    const requestId = loadRequestIdRef.current;
    await loadMailbox(supabaseCompany.id, user.id, requestId);
  };

  const inbox = messages.filter(m => isInboxMessage(m));
  const sent = messages.filter(m => m.sender_id === user?.id);
  const unreadInboxCount = inbox.filter(m => isUnreadInboxMessage(m)).length;
  const selectedRecipient = users.find(u => u.user_id === form.recipient_id);
  const hasValidDirectRecipient = Boolean(
    selectedRecipient &&
    selectedRecipient.user_id &&
    selectedRecipient.user_id !== user?.id &&
    users.some(u => u.user_id === selectedRecipient.user_id)
  );
  const hasMessageBody = Boolean(form.body.trim());
  const hasMessageContext = Boolean(user?.id && supabaseCompany?.id && !loadError && !loading);
  const canSend = hasMessageContext && !sending && hasMessageBody && (form.message_type === 'broadcast' || hasValidDirectRecipient);

  const handleSend = async () => {
    if (sendingRef.current) return;
    if (!hasMessageBody) return;
    if (!hasMessageContext) {
      toast.error('Messages unavailable');
      return;
    }
    if (form.message_type === 'direct' && !hasValidDirectRecipient) {
      toast.error('Select a recipient');
      return;
    }

    sendingRef.current = true;
    setSending(true);
    try {
      await onsiteApi.tables.messages.sendMember({
        company_id: supabaseCompany.id,
        message_type: form.message_type,
        recipient_id: form.message_type === 'direct' ? selectedRecipient.user_id : null,
        subject: form.subject,
        body: form.body,
      });
      if (!mountedRef.current) return;
      setShowCompose(false);
      resetComposeForm();
      try {
        await refreshMailbox();
      } catch (refreshError) {
        console.error('Failed to refresh messages after send:', refreshError);
        toast.error('Message sent, but messages could not refresh');
        return;
      }
      toast.success('Message sent');
    } catch (error) {
      console.error('Failed to send Supabase Message:', error);
      if (mountedRef.current) {
        toast.error(error.message || 'Failed to send message');
      }
    } finally {
      sendingRef.current = false;
      if (mountedRef.current) {
        setSending(false);
      }
    }
  };

  const markRead = async (msg) => {
    if (!supabaseCompany?.id || !isUnreadInboxMessage(msg)) return;
    try {
      await onsiteApi.tables.messages.markRead(msg.id, { company_id: supabaseCompany.id });
      await refreshMailbox();
    } catch (error) {
      console.error('Failed to mark Supabase Message read:', error);
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
        <button
          onClick={() => setShowCompose(true)}
          disabled={!hasMessageContext}
          className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center disabled:opacity-50"
        >
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
              {tab === 'inbox' && unreadInboxCount > 0 && (
                <span className="ml-1.5 bg-destructive text-destructive-foreground text-xs px-1.5 py-0.5 rounded-full">
                  {unreadInboxCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Message List */}
      <div className="px-6 space-y-3">
        {loading ? (
          <div className="text-center py-16">
            <MessageSquare className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">Loading messages...</p>
          </div>
        ) : loadError ? (
          <div className="text-center py-16">
            <MessageSquare className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">{loadError}</p>
          </div>
        ) : displayList.length === 0 ? (
          <div className="text-center py-16">
            <MessageSquare className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground">No messages</p>
          </div>
        ) : displayList.map(msg => {
          const unreadInbox = isUnreadInboxMessage(msg);
          const displayName = activeTab === 'inbox'
            ? (msg.sender_name || msg.sender_email || 'Unknown')
            : `To: ${msg.recipient_name || msg.recipient_email || 'Unknown'}`;
          const avatarName = activeTab === 'inbox'
            ? (msg.sender_name || msg.sender_email)
            : (msg.recipient_name || msg.recipient_email);

          return (
          <div key={msg.id} onClick={() => markRead(msg)}
            className={`bg-card border rounded-2xl p-4 cursor-pointer transition-all active:scale-95 ${unreadInbox ? 'border-primary/30 bg-primary/5' : 'border-border'}`}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                <span className="font-bold text-sm">
                  {avatarName?.charAt(0)?.toUpperCase() || '?'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <p className={`font-semibold text-sm truncate ${unreadInbox ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {displayName}
                  </p>
                  <p className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                    {msg.created_at ? format(parseISO(msg.created_at), 'MMM d') : ''}
                  </p>
                </div>
                {msg.subject && <p className="text-sm font-medium text-foreground truncate">{msg.subject}</p>}
                <p className="text-xs text-muted-foreground truncate mt-0.5">{msg.body}</p>
              </div>
              {unreadInbox && (
                <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
              )}
            </div>
          </div>
          );
        })}
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
              <button onClick={() => setForm(f => ({ ...f, message_type: 'direct', recipient_id: '', recipient_name: '' }))}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${form.message_type === 'direct' ? 'bg-card shadow text-foreground' : 'text-muted-foreground'}`}>
                <Mail className="w-4 h-4" /> Direct
              </button>
              <button onClick={() => setForm(f => ({ ...f, message_type: 'broadcast', recipient_id: '', recipient_name: 'All Workers' }))}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-semibold transition-all ${form.message_type === 'broadcast' ? 'bg-card shadow text-foreground' : 'text-muted-foreground'}`}>
                <Users className="w-4 h-4" /> Broadcast
              </button>
            </div>

            <div className="space-y-3">
              {form.message_type === 'direct' && (
                <select value={form.recipient_id}
                  disabled={directoryLoading || Boolean(directoryError) || users.length === 0}
                  onChange={e => {
                    const u = users.find(u => u.user_id === e.target.value);
                    setForm(f => ({ ...f, recipient_id: e.target.value, recipient_name: workerDisplayName(u) }));
                  }}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-foreground outline-none">
                  {directoryLoading ? (
                    <option value="">Loading recipients...</option>
                  ) : directoryError ? (
                    <option value="">Recipients unavailable</option>
                  ) : users.length === 0 ? (
                    <option value="">No other workers available</option>
                  ) : (
                    <>
                      <option value="">Select recipient...</option>
                      {users.map(u => (
                        <option key={u.id} value={u.user_id} className="bg-card">{workerDisplayName(u)} ({u.email})</option>
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
              {sending ? 'Sending...' : 'Send Message'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
