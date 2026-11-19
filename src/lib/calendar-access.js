const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const APPROVED_ROLES = new Set(['owner', 'admin', 'worker']);

const isCalendarDateKey = (value) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

export const normalizeCalendarRole = role => role === 'supervisor' ? 'worker' : role;

export const resolveCalendarReadScope = ({ userId, company, membership }) => {
  const role = normalizeCalendarRole(membership?.role);
  if (
    typeof userId !== 'string'
    || !UUID_PATTERN.test(userId)
    || !company
    || typeof company.id !== 'string'
    || !UUID_PATTERN.test(company.id)
    || !membership
    || typeof membership.company_id !== 'string'
    || typeof membership.user_id !== 'string'
    || membership.company_id.toLowerCase() !== company.id.toLowerCase()
    || membership.user_id.toLowerCase() !== userId.toLowerCase()
    || !APPROVED_ROLES.has(role)
  ) return null;

  return {
    userId: userId.toLowerCase(),
    companyId: company.id.toLowerCase(),
    companyName: typeof company.name === 'string' ? company.name : '',
    role,
  };
};

export const createCalendarRequestKey = (scope, startDate, endDate) => {
  if (!scope || !isCalendarDateKey(startDate) || !isCalendarDateKey(endDate) || endDate < startDate) return null;
  const days = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000;
  if (days > 370) return null;
  return `${scope.userId}:${scope.companyId}:${scope.role}:${startDate}:${endDate}`;
};

export const isCalendarPermissionError = error => (
  error?.code === '28000'
  || error?.code === '42501'
  || /authentication|permission|not authorized|active company/i.test(error?.message || '')
);
