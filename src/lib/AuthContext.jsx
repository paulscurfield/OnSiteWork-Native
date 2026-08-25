import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onsiteApi } from '@/api/supabase/adapter';

const AuthContext = createContext(null);

const authRequiredError = {
  type: 'auth_required',
  message: 'Authentication required',
};

const authUnavailableError = (error) => ({
  type: 'auth_error',
  message: error?.message || 'Authentication is unavailable',
});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState(null);

  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);

  const applySession = useCallback((session) => {
    const nextUser = session?.user ?? null;
    setUser(nextUser);
    setIsAuthenticated(Boolean(nextUser));
    setAuthError(nextUser ? null : authRequiredError);
    setIsLoadingAuth(false);
    setIsLoadingPublicSettings(false);
    setAppPublicSettings(null);
    setAuthChecked(true);
  }, []);

  const applyAuthFailure = useCallback((error) => {
    setUser(null);
    setIsAuthenticated(false);
    setAuthError(authUnavailableError(error));
    setIsLoadingAuth(false);
    setIsLoadingPublicSettings(false);
    setAppPublicSettings(null);
    setAuthChecked(true);
  }, []);

  const checkUserAuth = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoadingAuth(true);
    setIsLoadingPublicSettings(false);
    setAuthError(null);
    setAppPublicSettings(null);

    try {
      const session = await onsiteApi.auth.getSession();
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      applySession(session);
    } catch (error) {
      console.error('Supabase auth check failed:', error);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      applyAuthFailure(error);
    }
  }, [applyAuthFailure, applySession]);

  const checkAppState = useCallback(() => {
    return checkUserAuth();
  }, [checkUserAuth]);

  useEffect(() => {
    mountedRef.current = true;
    const requestId = ++requestIdRef.current;
    let unsubscribe = () => {};

    setIsLoadingAuth(true);
    setIsLoadingPublicSettings(false);
    setAppPublicSettings(null);

    onsiteApi.auth
      .getSession()
      .then((session) => {
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        applySession(session);
      })
      .catch((error) => {
        console.error('Supabase auth initialization failed:', error);
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        applyAuthFailure(error);
      });

    unsubscribe = onsiteApi.auth.onAuthStateChange((_event, session) => {
      requestIdRef.current += 1;
      if (!mountedRef.current) return;
      applySession(session);
    });

    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      unsubscribe();
    };
  }, [applyAuthFailure, applySession]);

  const logout = useCallback(async (shouldRedirect = true) => {
    try {
      await onsiteApi.auth.logout();
    } catch (error) {
      console.error('Supabase logout failed:', error);
    } finally {
      setUser(null);
      setIsAuthenticated(false);
      setAuthError(authRequiredError);
      setIsLoadingAuth(false);
      setIsLoadingPublicSettings(false);
      setAppPublicSettings(null);
      setAuthChecked(true);

      if (shouldRedirect) {
        window.location.href = `${window.location.origin}/login`;
      }
    }
  }, []);

  const navigateToLogin = useCallback(() => {
    window.location.href = `${window.location.origin}/login`;
  }, []);

  const requestMagicLink = useCallback((email) => {
    return onsiteApi.auth.signInWithOtp({
      email,
      redirectTo: `${window.location.origin}/`,
    });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoadingAuth,
        isLoadingPublicSettings,
        authError,
        appPublicSettings,
        authChecked,
        logout,
        navigateToLogin,
        checkUserAuth,
        checkAppState,
        requestMagicLink,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
