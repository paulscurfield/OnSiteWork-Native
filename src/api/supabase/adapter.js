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
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const JOB_STATUS_VALUES = new Set(['active', 'completed', 'on_hold']);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

const isLeapYear = (year) => {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
};

const toDateOnly = (value, fieldName) => {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a YYYY-MM-DD date string`);
  }
  const match = value.match(DATE_ONLY_PATTERN);
  if (!match) throw new Error(`${fieldName} must be a YYYY-MM-DD date string`);

  const [year, month, day] = value.split('-').map(Number);
  if (year < 1) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }

  if (month < 1 || month > 12) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }

  const maxDay = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  if (day < 1 || day > maxDay) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }

  return value;
};

const optionalId = (value) => {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
};

const requiredUuid = (value, fieldName) => {
  const id = optionalId(value);
  if (!id) throw new Error(`${fieldName} is required`);
  if (!UUID_PATTERN.test(id)) throw new Error(`${fieldName} must be a Supabase UUID`);
  return id;
};

const optionalUuid = (value, fieldName) => {
  const id = optionalId(value);
  if (!id) return null;
  if (!UUID_PATTERN.test(id)) throw new Error(`${fieldName} must be a Supabase UUID`);
  return id;
};

const optionalText = (value) => {
  if (value === undefined) return undefined;
  return optionalId(value);
};

const requiredText = (value, fieldName) => {
  const trimmed = optionalId(value);
  if (!trimmed) throw new Error(`${fieldName} is required`);
  return trimmed;
};

const optionalNumber = (value, fieldName) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) throw new Error(`${fieldName} must be a valid number`);
  return numberValue;
};

const optionalTimestamp = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return String(value).trim();
};

const requiredTimestamp = (value, fieldName) => {
  const timestamp = optionalTimestamp(value);
  if (!timestamp) throw new Error(`${fieldName} is required`);
  return timestamp;
};

const nullableNumberParam = (value, fieldName) => optionalNumber(value, fieldName) ?? null;

const lunchBreakParam = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  return optionalNumber(value, 'lunch_break_mins');
};

const normalizeJobStatus = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === '') {
    if (fallback !== undefined) return fallback;
    throw new Error('Job status must be active, completed, or on_hold');
  }
  const status = String(value).trim();
  if (!JOB_STATUS_VALUES.has(status)) {
    throw new Error('Job status must be active, completed, or on_hold');
  }
  return status;
};

const normalizeJobsOrderBy = (orderBy) => {
  if (!orderBy) return orderBy;
  const descending = orderBy.startsWith('-');
  const column = descending ? orderBy.slice(1) : orderBy;
  const mappedColumn = column === 'created_date'
    ? 'created_at'
    : column === 'updated_date'
      ? 'updated_at'
      : column;
  return `${descending ? '-' : ''}${mappedColumn}`;
};

const mapJobRow = (job = {}) => ({
  ...job,
  created_date: job.created_date ?? job.created_at,
  updated_date: job.updated_date ?? job.updated_at,
});

const normalizeJobCreateValues = (values = {}) => {
  const companyId = optionalId(values.company_id);
  if (!companyId) throw new Error('company_id is required');

  return {
    company_id: companyId,
    job_name: requiredText(values.job_name, 'job_name'),
    job_number: requiredText(values.job_number, 'job_number'),
    location_address: optionalText(values.location_address) ?? null,
    latitude: optionalNumber(values.latitude, 'latitude') ?? null,
    longitude: optionalNumber(values.longitude, 'longitude') ?? null,
    notes: optionalText(values.notes) ?? null,
    status: normalizeJobStatus(values.status, 'active'),
  };
};

const normalizeJobUpdateValues = (values = {}) => {
  const updateValues = {};

  if (hasOwn(values, 'job_name')) {
    updateValues.job_name = requiredText(values.job_name, 'job_name');
  }
  if (hasOwn(values, 'job_number')) {
    updateValues.job_number = requiredText(values.job_number, 'job_number');
  }
  if (hasOwn(values, 'location_address')) {
    updateValues.location_address = optionalText(values.location_address) ?? null;
  }
  if (hasOwn(values, 'latitude')) {
    updateValues.latitude = optionalNumber(values.latitude, 'latitude') ?? null;
  }
  if (hasOwn(values, 'longitude')) {
    updateValues.longitude = optionalNumber(values.longitude, 'longitude') ?? null;
  }
  if (hasOwn(values, 'notes')) {
    updateValues.notes = optionalText(values.notes) ?? null;
  }
  if (hasOwn(values, 'status')) {
    updateValues.status = normalizeJobStatus(values.status);
  }

  return updateValues;
};

const assignmentUserId = (value) => {
  if (value && typeof value === 'object') {
    return value.user_id ?? value.worker_id;
  }
  return value;
};

const scheduleAssignmentInput = (values = {}) => {
  if (hasOwn(values, 'assigned_user_ids') && values.assigned_user_ids !== undefined) {
    return values.assigned_user_ids;
  }
  if (hasOwn(values, 'assignments') && values.assignments !== undefined) {
    return values.assignments;
  }
  if (hasOwn(values, 'assigned_workers') && values.assigned_workers !== undefined) {
    return values.assigned_workers;
  }
  if (hasOwn(values, 'worker_ids') && values.worker_ids !== undefined) {
    return values.worker_ids;
  }
  return undefined;
};

const hasScheduleAssignmentInput = (values = {}) => {
  return (
    (hasOwn(values, 'assigned_user_ids') && values.assigned_user_ids !== undefined) ||
    (hasOwn(values, 'assignments') && values.assignments !== undefined) ||
    (hasOwn(values, 'assigned_workers') && values.assigned_workers !== undefined) ||
    (hasOwn(values, 'worker_ids') && values.worker_ids !== undefined)
  );
};

const normalizeWorkerIds = (values) => {
  if (values === undefined) return [];
  if (!Array.isArray(values)) {
    throw new Error('Schedule assignment workers must be an array of user UUIDs');
  }
  const rawValues = values;
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

const assertDateRange = (startDate, endDate) => {
  if (endDate < startDate) {
    throw new Error('end_date cannot be before start_date');
  }
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

const mapRpcTimeEntryResult = (result) => {
  return result?.time_entry ?? null;
};

const mapRpcTeamMapEntries = (result) => {
  return Array.isArray(result?.entries) ? result.entries : [];
};

const timeEntryClockInParams = (values = {}) => ({
  p_company_id: requiredUuid(values.company_id, 'company_id'),
  p_job_id: requiredUuid(values.job_id, 'job_id'),
  p_date: toDateOnly(values.date, 'date'),
  p_start_time: requiredTimestamp(values.start_time, 'start_time'),
  p_worker_lat: nullableNumberParam(values.worker_lat, 'worker_lat'),
  p_worker_lng: nullableNumberParam(values.worker_lng, 'worker_lng'),
  p_notes: optionalText(values.notes) ?? null,
});

const timeEntryClockOutParams = (id, values = {}) => ({
  p_time_entry_id: requiredUuid(id, 'time_entry_id'),
  p_finish_time: requiredTimestamp(values.finish_time, 'finish_time'),
  p_lunch_break_mins: lunchBreakParam(values.lunch_break_mins),
});

const timeEntryManualJobParams = (values = {}) => {
  const jobId = optionalUuid(values.job_id, 'job_id');

  return {
    p_job_id: jobId,
    p_date: toDateOnly(values.date, 'date'),
    p_start_time: requiredTimestamp(values.start_time, 'start_time'),
    p_finish_time: optionalTimestamp(values.finish_time),
    p_lunch_break_mins: lunchBreakParam(values.lunch_break_mins),
    p_job_name: jobId ? null : optionalText(values.job_name) ?? null,
    p_job_number: jobId ? null : optionalText(values.job_number) ?? null,
    p_notes: optionalText(values.notes) ?? null,
  };
};

const timeEntryManualParams = (values = {}) => ({
  p_company_id: requiredUuid(values.company_id, 'company_id'),
  p_worker_id: requiredUuid(values.worker_id, 'worker_id'),
  ...timeEntryManualJobParams(values),
});

const timeEntryManualUpdateParams = (id, values = {}) => {
  return {
    p_time_entry_id: requiredUuid(id, 'time_entry_id'),
    ...timeEntryManualJobParams(values),
  };
};

const scheduleRpcParams = (values = {}) => {
  const startDate = toDateOnly(values.start_date, 'start_date');
  const endDate = toDateOnly(values.end_date, 'end_date');
  assertDateRange(startDate, endDate);

  return {
    p_title: values.title,
    p_start_date: startDate,
    p_end_date: endDate,
    p_job_id: optionalId(values.job_id),
    p_leave_request_id: optionalId(values.leave_request_id),
    p_job_name: values.job_name ?? null,
    p_job_number: values.job_number ?? null,
    p_color: values.color ?? null,
    p_notes: values.notes ?? null,
    p_source_type: values.source_type ?? null,
    p_legacy_base44_id: values.legacy_base44_id ?? null,
    p_assigned_user_ids: normalizeWorkerIds(scheduleAssignmentInput(values)),
  };
};

const mergeScheduleUpdateValues = (existing, values = {}) => {
  const merged = {
    title: existing.title,
    start_date: existing.start_date,
    end_date: existing.end_date,
    job_id: existing.job_id,
    leave_request_id: existing.leave_request_id,
    job_name: existing.job_name,
    job_number: existing.job_number,
    color: existing.color,
    notes: existing.notes,
    source_type: existing.source_type,
    legacy_base44_id: existing.legacy_base44_id,
  };

  Object.keys(merged).forEach((key) => {
    if (hasOwn(values, key) && values[key] !== undefined) {
      merged[key] = values[key];
    }
  });

  merged.assigned_user_ids = hasScheduleAssignmentInput(values)
    ? normalizeWorkerIds(scheduleAssignmentInput(values))
    : existing.assigned_user_ids;

  return merged;
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

const normalizeWorkerDirectoryName = (value) => {
  const trimmed = optionalId(value);
  return trimmed || null;
};

const mapCompanyWorkerDirectoryEntry = (entry = {}) => {
  const fullName = normalizeWorkerDirectoryName(entry.full_name);
  const email = normalizeWorkerDirectoryName(entry.email);
  const userId = entry.user_id;

  return {
    user_id: userId,
    role: entry.role,
    full_name: fullName,
    email,
    display_name:
      normalizeWorkerDirectoryName(entry.display_name) ||
      fullName ||
      email ||
      `Worker • ${String(userId || 'unknown').slice(0, 8)}`,
  };
};

const createCompanyMembersAdapter = () => ({
  ...createTableAdapter('company_members'),

  async directory(companyId) {
    const normalizedCompanyId = optionalId(companyId);
    if (!normalizedCompanyId) throw new Error('companyId is required');
    if (!UUID_PATTERN.test(normalizedCompanyId)) throw new Error('companyId must be a company UUID');

    const { data, error } = await supabase.rpc('list_company_worker_directory', {
      p_company_id: normalizedCompanyId,
    });
    if (error) throw error;
    return (data || []).map(mapCompanyWorkerDirectoryEntry);
  },
});

const createJobsAdapter = () => ({
  async list() {
    throw new Error('Use jobs.filter({ company_id }) so jobs remain company-scoped');
  },

  async filter(filters = {}, orderBy = '-created_date', limit) {
    const companyId = optionalId(filters.company_id);
    if (!companyId) throw new Error('company_id is required when reading jobs');

    let query = supabase.from('jobs').select('*');
    query = applyFilters(query, { ...filters, company_id: companyId });
    query = orderQuery(query, normalizeJobsOrderBy(orderBy));
    if (limit) query = query.limit(limit);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapJobRow);
  },

  async create(values) {
    const { data, error } = await supabase
      .from('jobs')
      .insert(normalizeJobCreateValues(values))
      .select()
      .single();
    if (error) throw error;
    return mapJobRow(data);
  },

  async update(id, values) {
    const updateValues = normalizeJobUpdateValues(values);
    if (Object.keys(updateValues).length === 0) {
      throw new Error('No editable job fields supplied');
    }

    const { data, error } = await supabase
      .from('jobs')
      .update(updateValues)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return mapJobRow(data);
  },

  async delete(id) {
    const { error } = await supabase.from('jobs').delete().eq('id', id);
    if (error) throw error;
    return true;
  },
});

const createTimeEntriesAdapter = () => {
  const baseAdapter = createTableAdapter('time_entries');

  return {
    ...baseAdapter,

    async create() {
      throw new Error('Use timeEntries.clockIn() or timeEntries.createManual() so TimeEntry writes use secure RPCs');
    },

    async update() {
      throw new Error('Use timeEntries.clockOut() or timeEntries.updateManual() so TimeEntry writes use secure RPCs');
    },

    async getMyActive(companyId) {
      const { data, error } = await supabase.rpc('get_my_active_time_entry', {
        p_company_id: requiredUuid(companyId, 'company_id'),
      });
      if (error) throw error;
      return mapRpcTimeEntryResult(data);
    },

    async clockIn(values) {
      const { data, error } = await supabase.rpc('clock_in_time_entry', timeEntryClockInParams(values));
      if (error) throw error;
      return mapRpcTimeEntryResult(data);
    },

    async clockOut(id, values) {
      const { data, error } = await supabase.rpc('clock_out_time_entry', timeEntryClockOutParams(id, values));
      if (error) throw error;
      return mapRpcTimeEntryResult(data);
    },

    async createManual(values) {
      const { data, error } = await supabase.rpc('create_manual_time_entry', timeEntryManualParams(values));
      if (error) throw error;
      return mapRpcTimeEntryResult(data);
    },

    async updateManual(id, values) {
      const { data, error } = await supabase.rpc('update_manual_time_entry', timeEntryManualUpdateParams(id, values));
      if (error) throw error;
      return mapRpcTimeEntryResult(data);
    },

    async delete(id) {
      const timeEntryId = requiredUuid(id, 'time_entry_id');
      const { data, error } = await supabase.rpc('delete_time_entry', {
        p_time_entry_id: timeEntryId,
      });
      if (error) throw error;
      return {
        deleted: Boolean(data?.deleted),
        id: data?.id ?? timeEntryId,
      };
    },
  };
};

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

  /**
   * @param {{ company_id?: string, start_date?: string, end_date?: string }} [range]
   * @param {string} [orderBy]
   */
  async forDateRange({ company_id, start_date, end_date } = {}, orderBy = 'start_date') {
    const startDate = toDateOnly(start_date, 'start_date');
    const endDate = toDateOnly(end_date, 'end_date');
    assertDateRange(startDate, endDate);
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
    const { data: existingRows, error: existingError } = await supabase
      .from('job_schedules')
      .select('*, job_schedule_assignments(*)')
      .eq('id', id)
      .limit(1);
    if (existingError) throw existingError;

    const existingSchedule = existingRows?.[0];
    if (!existingSchedule) {
      throw new Error('Job schedule not found or inaccessible');
    }

    const mergedValues = mergeScheduleUpdateValues(
      mapScheduleWithAssignments(existingSchedule, existingSchedule.job_schedule_assignments),
      values
    );

    const { data, error } = await supabase.rpc('update_job_schedule_with_assignments', {
      p_schedule_id: id,
      ...scheduleRpcParams(mergedValues),
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

const createTeamMapAdapter = () => ({
  async getTeamMapEntries(companyId) {
    const { data, error } = await supabase.rpc('get_team_map_entries', {
      p_company_id: requiredUuid(companyId, 'company_id'),
    });
    if (error) throw error;
    return mapRpcTeamMapEntries(data);
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
    companyMembers: createCompanyMembersAdapter(),
    jobs: createJobsAdapter(),
    timeEntries: createTimeEntriesAdapter(),
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

  teamMap: createTeamMapAdapter(),

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
