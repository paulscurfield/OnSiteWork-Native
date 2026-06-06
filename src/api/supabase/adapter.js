import { supabase } from './client';

const orderQuery = (query, orderBy) => {
  if (!orderBy) return query;
  const descending = orderBy.startsWith('-');
  const column = descending ? orderBy.slice(1) : orderBy;
  return query.order(column, { ascending: !descending });
};

const applyFilters = (query, filters = {}) => {
  return Object.entries(filters).reduce((nextQuery, [key, value]) => {
    if (value === undefined) return nextQuery;
    if (value === null) return nextQuery.is(key, null);
    return nextQuery.eq(key, value);
  }, query);
};

const createTableAdapter = (tableName) => ({
  async list(orderBy, limit) {
    let query = supabase.from(tableName).select('*');
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async filter(filters = {}, orderBy, limit) {
    let query = supabase.from(tableName).select('*');
    query = applyFilters(query, filters);
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  async create(values) {
    const { data, error } = await supabase
      .from(tableName)
      .insert(values)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, values) {
    const { data, error } = await supabase
      .from(tableName)
      .update(values)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async delete(id) {
    const { error } = await supabase.from(tableName).delete().eq('id', id);
    if (error) throw error;
    return true;
  },
});

export const onsiteApi = {
  auth: {
    async me() {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) return null;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userData.user.id)
        .single();
      if (error) throw error;
      return data;
    },

    async updateMe(values) {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('profiles')
        .update(values)
        .eq('id', userData.user.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    async logout() {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  },

  tables: {
    companies: createTableAdapter('companies'),
    companyMembers: createTableAdapter('company_members'),
    jobs: createTableAdapter('jobs'),
    timeEntries: createTableAdapter('time_entries'),
    equipment: createTableAdapter('equipment'),
    equipmentLogs: createTableAdapter('equipment_logs'),
    preStarts: createTableAdapter('pre_starts'),
    jobPhotos: createTableAdapter('job_photos'),
    leaveRequests: createTableAdapter('leave_requests'),
    messages: createTableAdapter('messages'),
    messageReads: createTableAdapter('message_reads'),
    invitations: createTableAdapter('invitations'),
  },

  storage: {
    async upload(bucket, path, file, options = {}) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, file, { upsert: false, ...options });
      if (error) throw error;
      return data;
    },

    async signedUrl(bucket, path, expiresIn = 3600) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, expiresIn);
      if (error) throw error;
      return data.signedUrl;
    },
  },
};
