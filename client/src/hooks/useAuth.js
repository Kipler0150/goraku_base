import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  requestPasswordReset as requestPasswordResetRequest,
  register as registerRequest,
  resetPassword as resetPasswordRequest,
  resendVerification as resendVerificationRequest,
  removeAvatar as removeAvatarRequest,
  uploadAvatar as uploadAvatarRequest
} from '../api/auth.js';

const initialState = { status: 'unauthenticated', user: null, error: null, verificationEmail: null };

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
        setState({ status: 'authenticated', user, error: null, verificationEmail: null });
      })
      .catch((error) => {
        if (controller.signal.aborted || requestRef.current?.requestId !== requestId) return;
        requestRef.current = null;
        if (error.status === 401 || error.code === 'INVALID_PAYLOAD') {
          setState({ status: 'unauthenticated', user: null, error: null, verificationEmail: null });
          return;
        }
        setState({ status: 'error', user: null, error, verificationEmail: null });
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
      if (user?.code === 'EMAIL_VERIFICATION_REQUIRED') {
        setState({ status: 'verification-required', user: null, error: null, verificationEmail: user.email });
        return user;
      }
      setState({ status: 'authenticated', user, error: null, verificationEmail: null });
      return user;
    } catch (error) {
      if (controller.signal.aborted || requestRef.current?.requestId !== requestId) return null;
      requestRef.current = null;
      setState({ status: 'unauthenticated', user: null, error, verificationEmail: null });
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
      setState({ status: 'unauthenticated', user: null, error: null, verificationEmail: null });
    } catch (error) {
      if (controller.signal.aborted || requestRef.current?.requestId !== requestId) return;
      requestRef.current = null;
      setState((current) => ({ ...current, status: 'authenticated', error }));
    }
  }, [cancelRequest]);

  const updateAvatar = useCallback(async (file) => {
    cancelRequest();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    requestRef.current = { controller, requestId };
    setState((current) => ({ ...current, status: 'updating-avatar', error: null }));

    try {
      const user = await uploadAvatarRequest(file, { signal: controller.signal });
      if (requestRef.current?.requestId !== requestId) return null;
      requestRef.current = null;
      setState({ status: 'authenticated', user, error: null, verificationEmail: null });
      return user;
    } catch (error) {
      if (controller.signal.aborted || requestRef.current?.requestId !== requestId) return null;
      requestRef.current = null;
      setState((current) => ({ ...current, status: 'authenticated', error }));
      return null;
    }
  }, [cancelRequest]);

  const removeAvatar = useCallback(async () => {
    cancelRequest();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    requestRef.current = { controller, requestId };
    setState((current) => ({ ...current, status: 'removing-avatar', error: null }));

    try {
      const user = await removeAvatarRequest({ signal: controller.signal });
      if (requestRef.current?.requestId !== requestId) return null;
      requestRef.current = null;
      setState({ status: 'authenticated', user, error: null, verificationEmail: null });
      return user;
    } catch (error) {
      if (controller.signal.aborted || requestRef.current?.requestId !== requestId) return null;
      requestRef.current = null;
      setState((current) => ({ ...current, status: 'authenticated', error }));
      return null;
    }
  }, [cancelRequest]);

  const clearSession = useCallback(() => {
    cancelRequest();
    setState({ status: 'unauthenticated', user: null, error: null, verificationEmail: null });
  }, [cancelRequest]);

  const resendVerification = useCallback(async (email) => {
    cancelRequest();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    requestRef.current = { controller, requestId };
    setState((current) => ({ ...current, status: 'resending-verification', error: null }));
    try {
      await resendVerificationRequest(email, { signal: controller.signal });
      if (requestRef.current?.requestId !== requestId) return false;
      requestRef.current = null;
      setState({ status: 'verification-required', user: null, error: null, verificationEmail: email });
      return true;
    } catch (error) {
      if (controller.signal.aborted || requestRef.current?.requestId !== requestId) return false;
      requestRef.current = null;
      setState((current) => ({ ...current, status: 'unauthenticated', error }));
      return false;
    }
  }, [cancelRequest]);

  const requestPasswordReset = useCallback(async (email) => {
    cancelRequest();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    requestRef.current = { controller, requestId };
    setState((current) => ({ ...current, status: 'requesting-password-reset', error: null }));
    try {
      await requestPasswordResetRequest(email, { signal: controller.signal });
      if (requestRef.current?.requestId !== requestId) return false;
      requestRef.current = null;
      setState({ status: 'unauthenticated', user: null, error: null, verificationEmail: null });
      return true;
    } catch (error) {
      if (controller.signal.aborted || requestRef.current?.requestId !== requestId) return false;
      requestRef.current = null;
      setState((current) => ({ ...current, status: 'unauthenticated', error }));
      return false;
    }
  }, [cancelRequest]);

  const resetPassword = useCallback(async (token, password) => {
    cancelRequest();
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    requestRef.current = { controller, requestId };
    setState((current) => ({ ...current, status: 'resetting-password', error: null }));
    try {
      await resetPasswordRequest(token, password, { signal: controller.signal });
      if (requestRef.current?.requestId !== requestId) return false;
      requestRef.current = null;
      setState({ status: 'unauthenticated', user: null, error: null, verificationEmail: null });
      return true;
    } catch (error) {
      if (controller.signal.aborted || requestRef.current?.requestId !== requestId) return false;
      requestRef.current = null;
      setState((current) => ({ ...current, status: 'unauthenticated', error }));
      return false;
    }
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
    updateAvatar,
    removeAvatar,
    resendVerification,
    requestPasswordReset,
    resetPassword,
    isBusy: state.status === 'loading'
      || state.status === 'authenticating'
      || state.status === 'logging-out'
      || state.status === 'updating-avatar'
      || state.status === 'removing-avatar'
      || state.status === 'resending-verification'
      || state.status === 'requesting-password-reset'
      || state.status === 'resetting-password'
  };
}
