const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const APPROVED_ROLES = new Set(['owner', 'admin', 'worker']);

const isDateKey = (value) => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

export const normalizeTimesheetRole = role => role === 'supervisor' ? 'worker' : role;

export const resolveTimesheetReadScope = ({ userId, company, membership }) => {
  const role = normalizeTimesheetRole(membership?.role);
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

export const canReadCompanyTimesheets = scope => scope?.role === 'owner' || scope?.role === 'admin';

export const createTimesheetRequestKey = (scope, anchorDate, view) => {
  if (!scope || !isDateKey(anchorDate) || !['mine', 'company'].includes(view)) return null;
  if (view === 'company' && !canReadCompanyTimesheets(scope)) return null;
  return `${scope.userId}:${scope.companyId}:${scope.role}:${view}:${anchorDate}`;
};

export const getSydneyDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Australia/Sydney',
    year: 'numeric',
  }).formatToParts(date);
  const part = type => parts.find(candidate => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const isTimesheetPermissionError = error => (
  error?.code === '28000'
  || error?.code === '42501'
  || /authentication|permission|not authorized|owner or admin|active company/i.test(error?.message || '')
);
