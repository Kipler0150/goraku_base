import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentUser, login as loginRequest, logout as logoutRequest, register as registerRequest } from '../api/auth.js';

const initialState = { status: 'unauthenticated', user: null, error: null };

export function useAuth({ checkOnMount = false } = {}) {
  const [state, setState] = useState(initialState);
  const requestRef = useRef(null);
  const requestIdRef = useRef(0);
  const mountTimerRef = useRef(null);

  const cancelRequest = useCallback(() => {
    if (mountTimerRef.current) {
      clearTimeout(mountTimerRef.current);
      mountTimerRef.current = null;
    }
    requestRef.current?.controller.abort();
    requestRef.current = null;
    requestIdRef.current += 1;
  }, []);

  const checkSession = useCallback(() => {
    mountTimerRef.current = null;
    cancelRequest();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    requestRef.current = { controller, requestId };
    setState({ status: 'loading', user: null, error: null });

    getCurrentUser({ signal: controller.signal })
      .then((user) => {
        if (requestRef.current?.requestId !== requestId) return;
        requestRef.current = null;
        setState({ status: 'authenticated', user, error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted || requestRef.current?.requestId !== requestId) return;
        requestRef.current = null;
        if (error.status === 401 || error.code === 'INVALID_PAYLOAD') {
          setState({ status: 'unauthenticated', user: null, error: null });
          return;
        }
        setState({ status: 'error', user: null, error });
      });
  }, [cancelRequest]);

  const authenticate = useCallback(async (request, credentials) => {
    cancelRequest();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    requestRef.current = { controller, requestId };
    setState({ status: 'authenticating', user: null, error: null });

    try {
      const user = await request(credentials, { signal: controller.signal });
      if (requestRef.current?.requestId !== requestId) return null;
      requestRef.current = null;
      setState({ status: 'authenticated', user, error: null });
      return user;
    } catch (error) {
      if (controller.signal.aborted || requestRef.current?.requestId !== requestId) return null;
      requestRef.current = null;
      setState({ status: 'unauthenticated', user: null, error });
      return null;
    }
  }, [cancelRequest]);

  const register = useCallback((credentials) => authenticate(registerRequest, credentials), [authenticate]);
  const login = useCallback((credentials) => authenticate(loginRequest, credentials), [authenticate]);

  const logout = useCallback(async () => {
    cancelRequest();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    requestRef.current = { controller, requestId };
    setState((current) => ({ ...current, status: 'logging-out', error: null }));

    try {
      await logoutRequest({ signal: controller.signal });
      if (requestRef.current?.requestId !== requestId) return;
      requestRef.current = null;
      setState({ status: 'unauthenticated', user: null, error: null });
    } catch (error) {
      if (controller.signal.aborted || requestRef.current?.requestId !== requestId) return;
      requestRef.current = null;
      setState((current) => ({ ...current, status: 'authenticated', error }));
    }
  }, [cancelRequest]);

  const clearSession = useCallback(() => {
    cancelRequest();
    setState({ status: 'unauthenticated', user: null, error: null });
  }, [cancelRequest]);

  useEffect(() => {
    if (!checkOnMount) return undefined;
    mountTimerRef.current = setTimeout(checkSession, 0);
    return () => {
      cancelRequest();
    };
  }, [cancelRequest, checkOnMount, checkSession]);

  return {
    ...state,
    checkSession,
    clearSession,
    register,
    login,
    logout,
    isBusy: state.status === 'loading' || state.status === 'authenticating' || state.status === 'logging-out'
  };
}
