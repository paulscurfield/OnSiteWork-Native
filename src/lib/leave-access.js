const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APPROVED_ROLES = new Set(['owner', 'admin', 'worker']);

export const normalizeLeaveRole = role => role === 'supervisor' ? 'worker' : role;

export const resolveLeaveReadScope = ({ userId, company, membership }) => {
  const role = normalizeLeaveRole(membership?.role);
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

export const createLeaveScopeKey = scope => (
  scope ? `${scope.userId}:${scope.companyId}:${scope.role}` : null
);

export const canReadCompanyLeave = scope => scope?.role === 'owner' || scope?.role === 'admin';

export const isLeavePermissionError = error => (
  error?.code === '42501'
  || /permission|not authorized|owner or admin|active company/i.test(error?.message || '')
);
