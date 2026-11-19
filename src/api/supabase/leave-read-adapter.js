const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LEAVE_TYPES = new Set(['annual', 'sick', 'personal', 'other']);
const LEAVE_STATUSES = new Set(['pending', 'approved', 'declined']);
const LEAVE_ROLES = new Set(['owner', 'admin', 'worker']);

const invalidResponse = field => new Error(`Leave response contains an invalid ${field}`);

const requiredUuid = (value, field) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) throw invalidResponse(field);
  return value.trim().toLowerCase();
};

const requiredText = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw invalidResponse(field);
  return value.trim();
};

const optionalText = (value, field) => {
  if (value === null) return null;
  if (typeof value !== 'string') throw invalidResponse(field);
  return value.trim() || null;
};

const isDateKey = (value) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

const requiredTimestamp = (value, field) => {
  const timestamp = requiredText(value, field);
  if (Number.isNaN(Date.parse(timestamp))) throw invalidResponse(field);
  return timestamp;
};

const optionalTimestamp = (value, field) => {
  const timestamp = optionalText(value, field);
  if (timestamp !== null && Number.isNaN(Date.parse(timestamp))) throw invalidResponse(field);
  return timestamp;
};

const normalizeScope = (scope) => {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('An authenticated Leave workspace is required');
  }
  const userId = requiredUuid(scope.userId, 'authenticated user');
  const companyId = requiredUuid(scope.companyId, 'active company');
  if (!LEAVE_ROLES.has(scope.role)) throw new Error('An authorised Leave role is required');
  return { userId, companyId, role: scope.role };
};

const safeWorkerName = (value) => {
  if (typeof value !== 'string') return 'Employee';
  const name = value.trim();
  if (
    !name
    || name.length > 200
    || name.includes('@')
    || /[\u0000-\u001F\u007F]/u.test(name)
    || !/[\p{L}]/u.test(name)
  ) return 'Employee';
  return name;
};

export const mapLeaveRequest = (row, expectedCompanyId) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalidResponse('request');

  const companyId = requiredUuid(row.company_id, 'company_id');
  if (companyId !== expectedCompanyId) throw new Error('Leave response crossed company scope');

  const leaveType = requiredText(row.leave_type, 'leave_type').toLowerCase();
  const status = requiredText(row.status, 'status').toLowerCase();
  const startDate = requiredText(row.start_date, 'start_date');
  const endDate = requiredText(row.end_date, 'end_date');
  if (
    !LEAVE_TYPES.has(leaveType)
    || !LEAVE_STATUSES.has(status)
    || !isDateKey(startDate)
    || !isDateKey(endDate)
    || endDate < startDate
  ) throw invalidResponse('request fields');

  return {
    id: requiredUuid(row.id, 'id'),
    company_id: companyId,
    leave_type: leaveType,
    start_date: startDate,
    end_date: endDate,
    notes: optionalText(row.notes, 'notes'),
    status,
    created_at: requiredTimestamp(row.created_at, 'created_at'),
    reviewed_at: optionalTimestamp(row.reviewed_at, 'reviewed_at'),
  };
};

export const mapAdminLeaveRequest = (row, expectedCompanyId) => ({
  ...mapLeaveRequest(row, expectedCompanyId),
  worker_name: safeWorkerName(row.worker_name),
});

const mapResponse = (value, expectedCompanyId, mapRequest) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.leave_requests)) {
    throw new Error('Leave response is missing requests');
  }
  return value.leave_requests.map(row => mapRequest(row, expectedCompanyId));
};

const permissionError = () => Object.assign(
  new Error('Company Leave requests require active Owner or Admin access'),
  { code: '42501' }
);

export const createLeaveReadAdapter = (rpc) => {
  if (typeof rpc !== 'function') throw new Error('A Supabase RPC client is required');

  return {
    async listMine(scope) {
      const normalized = normalizeScope(scope);
      const { data, error } = await rpc('get_my_leave_requests', {
        p_company_id: normalized.companyId,
      });
      if (error) throw error;
      return mapResponse(data, normalized.companyId, mapLeaveRequest);
    },

    async listCompany(scope) {
      const normalized = normalizeScope(scope);
      if (normalized.role !== 'owner' && normalized.role !== 'admin') throw permissionError();
      const { data, error } = await rpc('get_company_leave_requests_admin', {
        p_company_id: normalized.companyId,
      });
      if (error) throw error;
      return mapResponse(data, normalized.companyId, mapAdminLeaveRequest);
    },
  };
};
