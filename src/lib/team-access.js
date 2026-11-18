const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPROVED_ROLES = new Set(['owner', 'admin', 'worker']);

export const resolveTeamReadScope = ({ userId, company, membership }) => {
  if (
    typeof userId !== 'string' ||
    !UUID_PATTERN.test(userId) ||
    !company ||
    typeof company.id !== 'string' ||
    !UUID_PATTERN.test(company.id) ||
    !membership ||
    typeof membership.company_id !== 'string' ||
    typeof membership.user_id !== 'string' ||
    membership.company_id.toLowerCase() !== company.id.toLowerCase() ||
    membership.user_id.toLowerCase() !== userId.toLowerCase() ||
    !APPROVED_ROLES.has(membership.role)
  ) return null;

  return {
    userId: userId.toLowerCase(),
    companyId: company.id.toLowerCase(),
    companyName: typeof company.name === 'string' ? company.name : '',
    role: membership.role,
  };
};

export const createTeamScopeKey = scope => (
  scope ? `${scope.userId}:${scope.companyId}:${scope.role}` : null
);
