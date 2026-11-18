const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const invalidResponse = () => new Error('Team directory returned an invalid member');

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

export const normalizeTeamRole = (role) => {
  if (role === 'owner' || role === 'admin' || role === 'worker') return role;
  if (role === 'supervisor') return 'worker';
  throw invalidResponse();
};

export const mapTeamDirectoryRow = (row) => {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalidResponse();

  return {
    member_id: requiredUuid(row.member_id, 'member_id'),
    user_id: requiredUuid(row.user_id, 'user_id'),
    full_name: optionalText(row.full_name),
    email: optionalText(row.email),
    phone: optionalText(row.phone),
    role: normalizeTeamRole(row.role),
  };
};

export const createTeamDirectoryReadAdapter = (rpc) => {
  if (typeof rpc !== 'function') throw new Error('A Supabase RPC client is required');

  return {
    async list(companyId) {
      const normalizedCompanyId = requiredUuid(companyId, 'companyId');
      const { data, error } = await rpc('get_company_team', {
        p_company_id: normalizedCompanyId,
      });

      if (error) throw error;
      if (data !== null && !Array.isArray(data)) throw invalidResponse();
      return (data ?? []).map(mapTeamDirectoryRow);
    },
  };
};
