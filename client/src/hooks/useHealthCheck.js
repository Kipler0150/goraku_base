import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchHealth } from '../api/health.js';

const initialState = { status: 'loading', error: null };

export function useHealthCheck() {
  const requestRef = useRef(null);
  const [state, setState] = useState(initialState);

  const check = useCallback(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState({ status: 'loading', error: null });

    fetchHealth({ signal: controller.signal })
      .then(() => {
        if (requestRef.current === controller) {
          setState({ status: 'connected', error: null });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted || requestRef.current !== controller) return;
        setState({ status: 'unavailable', error });
      });
  }, []);

  useEffect(() => {
    check();
    return () => requestRef.current?.abort();
  }, [check]);

  return { ...state, retry: check };
}
