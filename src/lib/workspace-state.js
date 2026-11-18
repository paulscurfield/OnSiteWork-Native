export const COMPANY_STATUS = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  UNAUTHENTICATED: 'unauthenticated',
  NO_MEMBERSHIP: 'no_company_membership',
  SELECTION_REQUIRED: 'workspace_selection_required',
  ERROR: 'error',
});

const emptyWorkspaceState = (status, resolvedUserId = null, error = null) => ({
  company: null,
  membership: null,
  workspaces: [],
  status,
  error,
  resolvedUserId,
});

export const createLoadingWorkspaceState = () => emptyWorkspaceState(COMPANY_STATUS.LOADING);

export const createUnauthenticatedWorkspaceState = () => (
  emptyWorkspaceState(COMPANY_STATUS.UNAUTHENTICATED)
);

const workspaceError = (message) => new Error(message || 'Workspace access could not be resolved.');

const sameWorkspace = (listed, active) => (
  listed.companyId === active.companyId &&
  listed.companyName === active.companyName &&
  listed.role === active.role
);

export const resolveWorkspaceSnapshot = ({ workspaces, activeWorkspace, userId }) => {
  if (!userId || !Array.isArray(workspaces)) {
    throw workspaceError('Workspace access response was invalid.');
  }

  if (workspaces.length === 0) {
    if (activeWorkspace !== null) throw workspaceError('Active workspace is not authorised.');
    return emptyWorkspaceState(COMPANY_STATUS.NO_MEMBERSHIP, userId);
  }

  const listedActive = workspaces.filter(workspace => workspace.isActive);
  if (!activeWorkspace) {
    if (listedActive.length !== 0 || workspaces.length === 1) {
      throw workspaceError('Active workspace response was inconsistent.');
    }

    return {
      ...emptyWorkspaceState(COMPANY_STATUS.SELECTION_REQUIRED, userId),
      workspaces,
    };
  }

  const listedWorkspace = workspaces.find(workspace => workspace.companyId === activeWorkspace.companyId);
  if (
    !listedWorkspace ||
    listedActive.length !== 1 ||
    listedActive[0].companyId !== activeWorkspace.companyId ||
    !sameWorkspace(listedWorkspace, activeWorkspace)
  ) {
    throw workspaceError('Active workspace is no longer authorised.');
  }

  return {
    company: {
      id: activeWorkspace.companyId,
      name: activeWorkspace.companyName,
    },
    membership: {
      company_id: activeWorkspace.companyId,
      user_id: userId,
      role: activeWorkspace.role,
    },
    workspaces,
    status: COMPANY_STATUS.READY,
    error: null,
    resolvedUserId: userId,
  };
};

export const getVisibleWorkspaceState = ({ state, userId, isAuthenticated, isLoadingAuth }) => {
  if (isLoadingAuth) return createLoadingWorkspaceState();
  if (!isAuthenticated || !userId) return createUnauthenticatedWorkspaceState();
  if (state.resolvedUserId !== userId) return createLoadingWorkspaceState();
  return state;
};

export const createLatestRequestGuard = () => {
  let currentRequest = 0;
  return {
    begin: () => ++currentRequest,
    invalidate: () => ++currentRequest,
    isCurrent: requestId => requestId === currentRequest,
  };
};

export const createWorkspaceSwitchQueue = () => {
  let tail = Promise.resolve();
  return {
    enqueue(operation) {
      const result = tail.catch(() => undefined).then(operation);
      tail = result.catch(() => undefined);
      return result;
    },
  };
};
