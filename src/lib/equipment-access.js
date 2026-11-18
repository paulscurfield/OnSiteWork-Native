const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPROVED_ROLES = new Set(['owner', 'admin', 'worker']);

export const resolveEquipmentReadScope = ({ userId, company, membership }) => {
  const role = membership?.role === 'supervisor' ? 'worker' : membership?.role;
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
    !APPROVED_ROLES.has(role)
  ) return null;

  return {
    userId: userId.toLowerCase(),
    companyId: company.id.toLowerCase(),
    companyName: typeof company.name === 'string' ? company.name : '',
    role,
  };
};

export const createEquipmentScopeKey = scope => (
  scope ? `${scope.userId}:${scope.companyId}:${scope.role}` : null
);

export const isEquipmentPermissionError = error => (
  error?.code === '42501' || error?.code === '28000'
);

const titleCaseIdentifier = value => value
  .split('_')
  .map((part, index) => index === 0
    ? `${part.charAt(0).toUpperCase()}${part.slice(1)}`
    : part)
  .join(' ');

export const equipmentCategoryLabel = category => titleCaseIdentifier(category);
export const equipmentStatusLabel = status => titleCaseIdentifier(status);
export const equipmentHistoryActionLabel = action => titleCaseIdentifier(action);
