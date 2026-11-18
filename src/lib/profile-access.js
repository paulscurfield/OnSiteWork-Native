const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APPROVED_ROLES = new Set(['owner', 'admin', 'worker']);

export const createProfileIdentityKey = userId => (
  typeof userId === 'string' && UUID_PATTERN.test(userId.trim())
    ? userId.trim().toLowerCase()
    : null
);

export const resolveProfileWorkspace = ({ userId, company, membership }) => {
  const normalizedUserId = createProfileIdentityKey(userId);
  const role = membership?.role === 'supervisor' ? 'worker' : membership?.role;
  if (
    !normalizedUserId ||
    !company ||
    typeof company.id !== 'string' ||
    !UUID_PATTERN.test(company.id) ||
    !membership ||
    typeof membership.company_id !== 'string' ||
    typeof membership.user_id !== 'string' ||
    membership.company_id.toLowerCase() !== company.id.toLowerCase() ||
    membership.user_id.toLowerCase() !== normalizedUserId ||
    !APPROVED_ROLES.has(role)
  ) return null;

  return {
    companyId: company.id.toLowerCase(),
    companyName: typeof company.name === 'string' ? company.name.trim() : '',
    role,
  };
};

export const profileRoleLabel = role => (
  role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Worker'
);

export const isProfilePermissionError = error => (
  error?.code === '42501' || error?.code === '28000'
);
