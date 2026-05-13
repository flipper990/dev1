'use client';

import { useCallback, useEffect, useState } from 'react';
import { AuthClientError, getSessionWithRefresh, signOut, type AuthUser } from '../lib/auth';

interface AuthSessionState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  authenticated: boolean;
}

export function useAuthSession() {
  const [state, setState] = useState<AuthSessionState>({
    user: null,
    loading: true,
    error: null,
    authenticated: false,
  });

  const refresh = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const session = await getSessionWithRefresh();
      setState({
        user: session.user,
        loading: false,
        error: null,
        authenticated: true,
      });
    } catch (error) {
      const authError = error as AuthClientError;
      setState({
        user: null,
        loading: false,
        error: authError.status === 401 ? null : authError.message,
        authenticated: false,
      });
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut();
    setState({
      user: null,
      loading: false,
      error: null,
      authenticated: false,
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    ...state,
    refresh,
    logout,
  };
}

