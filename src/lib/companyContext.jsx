import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onsiteApi } from '@/api/supabase/adapter';
import { useAuth } from '@/lib/AuthContext';

const CompanyContext = createContext(null);

const COMPANY_STATUS = {
  LOADING: 'loading',
  READY: 'ready',
  UNAUTHENTICATED: 'unauthenticated',
  NO_MEMBERSHIP: 'no_company_membership',
  MULTIPLE_MEMBERSHIPS: 'multiple_company_memberships',
  ERROR: 'error',
};

const companyErrorMessage = (error) => error?.message || 'Company access could not be resolved.';

export function CompanyProvider({ children }) {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const [company, setCompany] = useState(null);
  const [membership, setMembership] = useState(null);
  const [loadingCompany, setLoadingCompany] = useState(true);
  const [companyError, setCompanyError] = useState(null);
  const [companyStatus, setCompanyStatus] = useState(COMPANY_STATUS.LOADING);

  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);

  const clearCompany = useCallback((status, error = null) => {
    setCompany(null);
    setMembership(null);
    setCompanyStatus(status);
    setCompanyError(error);
    setLoadingCompany(false);
  }, []);

  const loadCompany = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    if (isLoadingAuth) {
      setLoadingCompany(true);
      setCompanyStatus(COMPANY_STATUS.LOADING);
      return;
    }

    if (!isAuthenticated || !user?.id) {
      clearCompany(COMPANY_STATUS.UNAUTHENTICATED);
      return;
    }

    setLoadingCompany(true);
    setCompany(null);
    setMembership(null);
    setCompanyError(null);
    setCompanyStatus(COMPANY_STATUS.LOADING);

    try {
      const memberships = await onsiteApi.tables.companyMembers.filter({ user_id: user.id });
      if (!mountedRef.current || requestId !== requestIdRef.current) return;

      if (memberships.length === 0) {
        clearCompany(COMPANY_STATUS.NO_MEMBERSHIP);
        return;
      }

      if (memberships.length > 1) {
        clearCompany(
          COMPANY_STATUS.MULTIPLE_MEMBERSHIPS,
          'Multiple company memberships were found. Company selection is required before continuing.'
        );
        return;
      }

      const resolvedMembership = memberships[0];
      const companies = await onsiteApi.tables.companies.filter({ id: resolvedMembership.company_id });
      if (!mountedRef.current || requestId !== requestIdRef.current) return;

      if (companies.length !== 1) {
        clearCompany(COMPANY_STATUS.ERROR, 'Company access could not be resolved.');
        return;
      }

      setCompany(companies[0]);
      setMembership(resolvedMembership);
      setCompanyError(null);
      setCompanyStatus(COMPANY_STATUS.READY);
      setLoadingCompany(false);
    } catch (error) {
      console.error('Failed to load Supabase company:', error);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      clearCompany(COMPANY_STATUS.ERROR, companyErrorMessage(error));
    }
  }, [clearCompany, isAuthenticated, isLoadingAuth, user?.id]);

  useEffect(() => {
    mountedRef.current = true;
    loadCompany();

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, [loadCompany]);

  const refreshCompany = useCallback(() => loadCompany(), [loadCompany]);

  return (
    <CompanyContext.Provider
      value={{
        company,
        membership,
        loadingCompany,
        companyError,
        companyStatus,
        refreshCompany,
        setCompany,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}
