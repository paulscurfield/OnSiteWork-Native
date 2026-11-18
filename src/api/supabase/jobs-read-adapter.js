const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_STATUS_VALUES = new Set(['active', 'on_hold', 'completed']);

export const JOB_READ_FIELDS = [
  'id',
  'company_id',
  'job_name',
  'job_number',
  'location_address',
  'latitude',
  'longitude',
  'notes',
  'status',
  'created_at',
  'updated_at',
].join(',');

const invalidResponse = () => new Error('Jobs query returned an invalid job');

const requiredUuid = (value, fieldName) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new Error(`${fieldName} must be a Supabase UUID`);
  }
  return value.trim().toLowerCase();
};

const optionalText = (value) => {
  if (value === null) return null;
  if (typeof value !== 'string') throw invalidResponse();
  return value.trim() || null;
};

const optionalCoordinate = (value) => {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidResponse();
  return value;
};

export const mapCompanyJobRow = (row, expectedCompanyId, expectedJobId = null) => {
  if (
    !row ||
    typeof row !== 'object' ||
    typeof row.id !== 'string' ||
    !UUID_PATTERN.test(row.id) ||
    typeof row.company_id !== 'string' ||
    !UUID_PATTERN.test(row.company_id) ||
    typeof row.job_name !== 'string' ||
    !row.job_name.trim() ||
    typeof row.job_number !== 'string' ||
    !row.job_number.trim() ||
    !JOB_STATUS_VALUES.has(row.status) ||
    typeof row.created_at !== 'string' ||
    !row.created_at ||
    typeof row.updated_at !== 'string' ||
    !row.updated_at
  ) {
    throw invalidResponse();
  }

  const id = row.id.toLowerCase();
  const companyId = row.company_id.toLowerCase();
  if (companyId !== expectedCompanyId || (expectedJobId && id !== expectedJobId)) {
    throw invalidResponse();
  }

  return {
    id,
    company_id: companyId,
    job_name: row.job_name.trim(),
    job_number: row.job_number.trim(),
    location_address: optionalText(row.location_address),
    latitude: optionalCoordinate(row.latitude),
    longitude: optionalCoordinate(row.longitude),
    notes: optionalText(row.notes),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

export const createJobsReadAdapter = (from) => {
  if (typeof from !== 'function') throw new Error('A Supabase table client is required');

  return {
    async list(companyId, status) {
      const normalizedCompanyId = requiredUuid(companyId, 'companyId');
      if (status !== undefined && !JOB_STATUS_VALUES.has(status)) {
        throw new Error('status must be active, on_hold, or completed');
      }

      let query = from('jobs')
        .select(JOB_READ_FIELDS)
        .eq('company_id', normalizedCompanyId);
      if (status) query = query.eq('status', status);

      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw error;
      if (data !== null && !Array.isArray(data)) throw invalidResponse();
      return (data ?? []).map(row => mapCompanyJobRow(row, normalizedCompanyId));
    },

    async get(companyId, jobId) {
      const normalizedCompanyId = requiredUuid(companyId, 'companyId');
      const normalizedJobId = requiredUuid(jobId, 'jobId');
      const { data, error } = await from('jobs')
        .select(JOB_READ_FIELDS)
        .eq('company_id', normalizedCompanyId)
        .eq('id', normalizedJobId)
        .maybeSingle();

      if (error) throw error;
      return data ? mapCompanyJobRow(data, normalizedCompanyId, normalizedJobId) : null;
    },
  };
};
