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

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toDateOnly = (value, fieldName) => {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a YYYY-MM-DD date string`);
  }
  return value;
};

const optionalId = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const assignmentUserId = (value) => {
  if (value && typeof value === 'object') {
    return value.user_id ?? value.worker_id;
  }
  return value;
};

const scheduleAssignmentInput = (values = {}) => {
  return values.assigned_user_ids ?? values.assignments ?? values.assigned_workers ?? values.worker_ids;
};

const normalizeWorkerIds = (values) => {
  const rawValues = Array.isArray(values) ? values : [];
  const ids = rawValues
    .map((value) => optionalId(assignmentUserId(value)))
    .filter(Boolean);
  const uniqueIds = [...new Set(ids)];
  const invalidIds = uniqueIds.filter((id) => !UUID_PATTERN.test(id));
  if (invalidIds.length > 0) {
    throw new Error('Schedule assignment workers must be user UUIDs; resolve worker emails before calling jobSchedules');
  }
  return uniqueIds;
};

const normalizeScheduleAssignments = (assignments = []) => {
  if (!Array.isArray(assignments)) return [];
  return [...assignments].sort((a, b) => {
    const createdAt = String(a.created_at || '').localeCompare(String(b.created_at || ''));
    if (createdAt !== 0) return createdAt;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
};

const mapScheduleWithAssignments = (schedule = {}, assignments = []) => {
  const normalizedAssignments = normalizeScheduleAssignments(assignments);
  const assignedUserIds = normalizeWorkerIds(
    normalizedAssignments.map((assignment) => assignment.user_id)
  );

  return {
    ...schedule,
    job_schedule_assignments: normalizedAssignments,
    assignments: normalizedAssignments,
    assigned_user_ids: assignedUserIds,
    assigned_workers: assignedUserIds,
  };
};

const mapRpcScheduleResult = (result) => {
  if (!result?.schedule) return result;
  return mapScheduleWithAssignments(result.schedule, result.assignments);
};

const scheduleRpcParams = (values = {}) => ({
  p_title: values.title,
  p_start_date: toDateOnly(values.start_date, 'start_date'),
  p_end_date: toDateOnly(values.end_date, 'end_date'),
  p_job_id: optionalId(values.job_id),
  p_leave_request_id: optionalId(values.leave_request_id),
  p_job_name: values.job_name ?? null,
  p_job_number: values.job_number ?? null,
  p_color: values.color ?? null,
  p_notes: values.notes ?? null,
  p_source_type: values.source_type ?? null,
  p_legacy_base44_id: values.legacy_base44_id ?? null,
  p_assigned_user_ids: normalizeWorkerIds(scheduleAssignmentInput(values)),
});

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

const createJobSchedulesAdapter = () => ({
  async list(orderBy = 'start_date', limit) {
    let query = supabase
      .from('job_schedules')
      .select('*, job_schedule_assignments(*)');
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((schedule) =>
      mapScheduleWithAssignments(schedule, schedule.job_schedule_assignments)
    );
  },

  async filter(filters = {}, orderBy = 'start_date', limit) {
    let query = supabase
      .from('job_schedules')
      .select('*, job_schedule_assignments(*)');
    query = applyFilters(query, filters);
    query = orderQuery(query, orderBy);
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((schedule) =>
      mapScheduleWithAssignments(schedule, schedule.job_schedule_assignments)
    );
  },

  async forDateRange({ company_id, start_date, end_date } = {}, orderBy = 'start_date') {
    const startDate = toDateOnly(start_date, 'start_date');
    const endDate = toDateOnly(end_date, 'end_date');
    let query = supabase
      .from('job_schedules')
      .select('*, job_schedule_assignments(*)')
      .lte('start_date', endDate)
      .gte('end_date', startDate);
    if (company_id !== undefined) query = query.eq('company_id', company_id);
    query = orderQuery(query, orderBy);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((schedule) =>
      mapScheduleWithAssignments(schedule, schedule.job_schedule_assignments)
    );
  },

  async create(values) {
    const { data, error } = await supabase.rpc('create_job_schedule_with_assignments', {
      p_company_id: values.company_id,
      ...scheduleRpcParams(values),
    });
    if (error) throw error;
    return mapRpcScheduleResult(data);
  },

  async update(id, values) {
    const { data, error } = await supabase.rpc('update_job_schedule_with_assignments', {
      p_schedule_id: id,
      ...scheduleRpcParams(values),
    });
    if (error) throw error;
    return mapRpcScheduleResult(data);
  },

  async delete(id) {
    const { error } = await supabase.from('job_schedules').delete().eq('id', id);
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
    jobSchedules: createJobSchedulesAdapter(),
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
