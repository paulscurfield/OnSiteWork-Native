import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { onsiteApi } from '@/api/supabase/adapter';
import { normalizeWorkspaceCompanyId } from '@/api/supabase/workspace-adapter';
import { useAuth } from '@/lib/AuthContext';
import {
  COMPANY_STATUS,
  createLatestRequestGuard,
  createLoadingWorkspaceState,
  createUnauthenticatedWorkspaceState,
  createWorkspaceSwitchQueue,
  getVisibleWorkspaceState,
  resolveWorkspaceSnapshot,
} from '@/lib/workspace-state';

const CompanyContext = createContext(null);

const companyErrorMessage = (error) => error?.message || 'Company access could not be resolved.';
const JWT_TIMING_RETRY_DELAY_MS = 750;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const isTransientJwtTimingError = (error) => {
  const message = error?.message || '';
  return error?.code === 'PGRST303' || message.toLowerCase().includes('jwt issued at future');
};

const withJwtTimingRetry = async (operation) => {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientJwtTimingError(error)) throw error;
    await delay(JWT_TIMING_RETRY_DELAY_MS);
    return operation();
  }
};

export function CompanyProvider({ children }) {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const queryClient = useQueryClient();
  const [workspaceState, setWorkspaceState] = useState(createLoadingWorkspaceState);
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState(null);

  const mountedRef = useRef(false);
  const authUserIdRef = useRef(null);
  const requestGuardRef = useRef(createLatestRequestGuard());
  const switchQueueRef = useRef(createWorkspaceSwitchQueue());

  const currentUserId = isAuthenticated && user?.id ? user.id : null;
  authUserIdRef.current = currentUserId;

  const loadWorkspaceSnapshot = useCallback(async ({ requestId, expectedUserId }) => {
    try {
      const [workspaces, activeWorkspace] = await withJwtTimingRetry(() => Promise.all([
        onsiteApi.workspaces.list(),
        onsiteApi.workspaces.getActive(),
      ]));

      if (
        !mountedRef.current ||
        !requestGuardRef.current.isCurrent(requestId) ||
        authUserIdRef.current !== expectedUserId
      ) return null;

      const nextState = resolveWorkspaceSnapshot({ workspaces, activeWorkspace, userId: expectedUserId });
      setWorkspaceState(nextState);
      setSwitchingWorkspaceId(null);
      return nextState;
    } catch (error) {
      if (
        !mountedRef.current ||
        !requestGuardRef.current.isCurrent(requestId) ||
        authUserIdRef.current !== expectedUserId
      ) return null;

      console.error('Failed to load Supabase workspace:', error);
      setWorkspaceState({
        ...createLoadingWorkspaceState(),
        status: COMPANY_STATUS.ERROR,
        error: companyErrorMessage(error),
        resolvedUserId: expectedUserId,
      });
      setSwitchingWorkspaceId(null);
      return null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGuardRef.current.invalidate();
    };
  }, []);

  useEffect(() => {
    const requestId = requestGuardRef.current.begin();
    setSwitchingWorkspaceId(null);
    queryClient.clear();

    if (isLoadingAuth) {
      setWorkspaceState(createLoadingWorkspaceState());
      return;
    }

    if (!currentUserId) {
      setWorkspaceState(createUnauthenticatedWorkspaceState());
      return;
    }

    setWorkspaceState(createLoadingWorkspaceState());
    loadWorkspaceSnapshot({ requestId, expectedUserId: currentUserId });
  }, [currentUserId, isLoadingAuth, loadWorkspaceSnapshot, queryClient]);

  const refreshCompany = useCallback(async () => {
    const expectedUserId = authUserIdRef.current;
    const requestId = requestGuardRef.current.begin();
    queryClient.clear();
    setSwitchingWorkspaceId(null);

    if (!expectedUserId) {
      setWorkspaceState(createUnauthenticatedWorkspaceState());
      return null;
    }

    setWorkspaceState(createLoadingWorkspaceState());
    return loadWorkspaceSnapshot({ requestId, expectedUserId });
  }, [loadWorkspaceSnapshot, queryClient]);

  const switchWorkspace = useCallback(async (companyId) => {
    const expectedUserId = authUserIdRef.current;
    if (!expectedUserId) throw new Error('Authentication required');

    const normalizedCompanyId = normalizeWorkspaceCompanyId(companyId);
    const authorisedWorkspace = workspaceState.workspaces.find(
      workspace => workspace.companyId === normalizedCompanyId
    );
    if (!authorisedWorkspace) {
      throw new Error('The requested workspace is not in the authorised workspace list');
    }

    const requestId = requestGuardRef.current.begin();
    setSwitchingWorkspaceId(normalizedCompanyId);
    setWorkspaceState(current => ({
      ...createLoadingWorkspaceState(),
      workspaces: current.workspaces,
    }));
    queryClient.clear();

    try {
      await switchQueueRef.current.enqueue(async () => {
        if (authUserIdRef.current !== expectedUserId) {
          throw new Error('Authentication changed before workspace selection completed');
        }
        return withJwtTimingRetry(() => onsiteApi.workspaces.setActive(normalizedCompanyId));
      });

      if (
        !mountedRef.current ||
        !requestGuardRef.current.isCurrent(requestId) ||
        authUserIdRef.current !== expectedUserId
      ) return null;

      const nextState = await loadWorkspaceSnapshot({ requestId, expectedUserId });
      if (nextState?.company?.id !== normalizedCompanyId) {
        throw new Error('The selected workspace could not be confirmed');
      }
      return nextState;
    } catch (error) {
      if (
        mountedRef.current &&
        requestGuardRef.current.isCurrent(requestId) &&
        authUserIdRef.current === expectedUserId
      ) {
        console.error('Failed to switch Supabase workspace:', error);
        setWorkspaceState({
          ...createLoadingWorkspaceState(),
          status: COMPANY_STATUS.ERROR,
          error: companyErrorMessage(error),
          resolvedUserId: expectedUserId,
        });
        setSwitchingWorkspaceId(null);
      }
      throw error;
    }
  }, [loadWorkspaceSnapshot, queryClient, workspaceState.workspaces]);

  const visibleState = getVisibleWorkspaceState({
    state: workspaceState,
    userId: currentUserId,
    isAuthenticated,
    isLoadingAuth,
  });

  const value = useMemo(() => ({
    company: visibleState.company,
    membership: visibleState.membership,
    workspaces: visibleState.workspaces,
    loadingCompany: visibleState.status === COMPANY_STATUS.LOADING,
    companyError: visibleState.error,
    companyStatus: visibleState.status,
    switchingWorkspaceId,
    refreshCompany,
    switchWorkspace,
  }), [refreshCompany, switchingWorkspaceId, switchWorkspace, visibleState]);

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (!context) throw new Error('useCompany must be used within a CompanyProvider');
  return context;
}
