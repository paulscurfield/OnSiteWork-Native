const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const malformedResponse = (rpcName) => new Error(`${rpcName} returned an invalid workspace response`);

const normalizeRole = (role, rpcName) => {
  if (typeof role !== 'string' || !role.trim()) {
    throw malformedResponse(rpcName);
  }

  return role === 'owner' || role === 'admin' ? role : 'worker';
};

const mapWorkspaceRow = (row, rpcName, includeActive) => {
  if (
    !row ||
    typeof row !== 'object' ||
    typeof row.company_id !== 'string' ||
    !UUID_PATTERN.test(row.company_id) ||
    typeof row.company_name !== 'string' ||
    !row.company_name.trim() ||
    (includeActive && typeof row.is_active !== 'boolean')
  ) {
    throw malformedResponse(rpcName);
  }

  return {
    companyId: row.company_id.toLowerCase(),
    companyName: row.company_name,
    role: normalizeRole(row.role, rpcName),
    ...(includeActive ? { isActive: row.is_active } : {}),
  };
};

const requireRows = (data, rpcName) => {
  if (data === null) return [];
  if (!Array.isArray(data)) throw malformedResponse(rpcName);
  return data;
};

const requireSingleOrEmptyRow = (data, rpcName) => {
  const rows = requireRows(data, rpcName);
  if (rows.length > 1) throw malformedResponse(rpcName);
  return rows[0] ?? null;
};

const callRpc = async (rpc, rpcName, params) => {
  const result = params === undefined
    ? await rpc(rpcName)
    : await rpc(rpcName, params);

  if (!result || typeof result !== 'object') throw malformedResponse(rpcName);
  if (result.error) throw result.error;
  if (!Object.prototype.hasOwnProperty.call(result, 'data')) throw malformedResponse(rpcName);
  return result.data;
};

export const normalizeWorkspaceCompanyId = (value) => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new Error('companyId must be a Supabase UUID');
  }
  return value.trim().toLowerCase();
};

export const createWorkspaceAdapter = (rpc) => {
  if (typeof rpc !== 'function') throw new Error('A Supabase RPC client is required');

  return {
    async list() {
      const rpcName = 'list_my_workspaces';
      const rows = requireRows(await callRpc(rpc, rpcName), rpcName);
      const workspaces = rows.map(row => mapWorkspaceRow(row, rpcName, true));
      const companyIds = new Set(workspaces.map(workspace => workspace.companyId));

      if (companyIds.size !== workspaces.length || workspaces.filter(workspace => workspace.isActive).length > 1) {
        throw malformedResponse(rpcName);
      }

      return workspaces;
    },

    async getActive() {
      const rpcName = 'get_active_workspace';
      const row = requireSingleOrEmptyRow(await callRpc(rpc, rpcName), rpcName);
      return row ? mapWorkspaceRow(row, rpcName, false) : null;
    },

    async setActive(companyId) {
      const rpcName = 'set_active_workspace';
      const normalizedCompanyId = normalizeWorkspaceCompanyId(companyId);
      const row = requireSingleOrEmptyRow(
        await callRpc(rpc, rpcName, { p_company_id: normalizedCompanyId }),
        rpcName
      );

      if (!row) throw malformedResponse(rpcName);
      const workspace = mapWorkspaceRow(row, rpcName, false);
      if (workspace.companyId !== normalizedCompanyId) throw malformedResponse(rpcName);
      return workspace;
    },
  };
};
