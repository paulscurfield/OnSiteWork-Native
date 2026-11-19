const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const CALENDAR_ROLES = new Set(['owner', 'admin', 'worker']);

const invalidResponse = field => new Error(`Calendar response contains an invalid ${field}`);

const requiredText = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw invalidResponse(field);
  return value.trim();
};

const optionalText = (value, field) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw invalidResponse(field);
  return value.trim() || null;
};

const requiredUuid = (value, field) => {
  const id = requiredText(value, field);
  if (!UUID_PATTERN.test(id)) throw invalidResponse(field);
  return id.toLowerCase();
};

const optionalUuid = (value, field) => {
  if (value === null || value === undefined) return null;
  return requiredUuid(value, field);
};

export const isCalendarDateKey = (value) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

const requiredDate = (value, field) => {
  const date = requiredText(value, field);
  if (!isCalendarDateKey(date)) throw invalidResponse(field);
  return date;
};

const requiredTimestamp = (value, field) => {
  const timestamp = requiredText(value, field);
  if (Number.isNaN(Date.parse(timestamp))) throw invalidResponse(field);
  return timestamp;
};

const dateRangeDays = (startDate, endDate) => (
  (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000
);

export const validateCalendarRange = (startDate, endDate) => {
  if (!isCalendarDateKey(startDate) || !isCalendarDateKey(endDate)) {
    throw new Error('Calendar date range must use valid YYYY-MM-DD dates');
  }
  if (endDate < startDate) throw new Error('Calendar end_date cannot be before start_date');
  if (dateRangeDays(startDate, endDate) > 370) {
    throw new Error('Calendar date range cannot exceed 371 days');
  }
  return { startDate, endDate };
};

const normalizeScope = (scope) => {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('An authenticated Calendar workspace is required');
  }
  const userId = requiredUuid(scope.userId, 'authenticated user');
  const companyId = requiredUuid(scope.companyId, 'active company');
  if (!CALENDAR_ROLES.has(scope.role)) throw new Error('An authorised Calendar role is required');
  return { userId, companyId, role: scope.role };
};

export const mapCalendarEvent = (row, expectedCompanyId, role) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalidResponse('event');

  const companyId = requiredUuid(row.company_id, 'company_id');
  if (companyId !== expectedCompanyId) throw new Error('Calendar response crossed company scope');

  const startDate = requiredDate(row.start_date, 'start_date');
  const endDate = requiredDate(row.end_date, 'end_date');
  if (endDate < startDate) throw invalidResponse('date range');

  const color = requiredText(row.color, 'color').toUpperCase();
  if (!HEX_COLOR_PATTERN.test(color)) throw invalidResponse('color');
  if (row.source_type !== 'manual' && row.source_type !== 'leave') throw invalidResponse('source_type');

  const sourceType = row.source_type;
  const returnedTitle = requiredText(row.title, 'title');
  const title = sourceType === 'leave' && returnedTitle.includes('@')
    ? 'Employee on Leave'
    : returnedTitle;
  const isAdmin = role === 'owner' || role === 'admin';

  return {
    id: requiredUuid(row.id, 'id'),
    company_id: companyId,
    job_id: sourceType === 'manual' ? optionalUuid(row.job_id, 'job_id') : null,
    title,
    job_name: sourceType === 'manual' ? optionalText(row.job_name, 'job_name') : null,
    job_number: sourceType === 'manual' ? optionalText(row.job_number, 'job_number') : null,
    start_date: startDate,
    end_date: endDate,
    color,
    notes: sourceType === 'manual' && isAdmin ? optionalText(row.notes, 'notes') : null,
    source_type: sourceType,
    created_at: requiredTimestamp(row.created_at, 'created_at'),
    updated_at: requiredTimestamp(row.updated_at, 'updated_at'),
  };
};

const mapResponse = (value, expectedCompanyId, role) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.events)) {
    throw new Error('Calendar response is missing events');
  }
  return value.events.map(event => mapCalendarEvent(event, expectedCompanyId, role));
};

export const createCalendarReadAdapter = (rpc) => {
  if (typeof rpc !== 'function') throw new Error('A Supabase RPC client is required');

  return {
    async list(scope, startDate, endDate) {
      const normalized = normalizeScope(scope);
      const range = validateCalendarRange(startDate, endDate);
      const { data, error } = await rpc('get_calendar_events', {
        p_company_id: normalized.companyId,
        p_start_date: range.startDate,
        p_end_date: range.endDate,
      });
      if (error) throw error;
      return mapResponse(data, normalized.companyId, normalized.role);
    },
  };
};
