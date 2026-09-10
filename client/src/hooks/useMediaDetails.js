import { useCallback, useEffect, useRef, useState } from 'react';
import { getMediaDetails } from '../api/mediaDetails.js';

const IDLE_STATE = Object.freeze({ status: 'idle', selectedMedia: null, media: null, error: null });

function typeForRequest(media) {
  return typeof media?.type === 'string' ? media.type.toLowerCase() : media?.type;
}

export function useMediaDetails({ includeAdult = true } = {}) {
  const [state, setState] = useState(IDLE_STATE);
  const requestRef = useRef(null);
  const latestMediaRef = useRef(null);
  const includeAdultRef = useRef(includeAdult);

  const cancel = useCallback(() => {
    requestRef.current?.controller.abort();
    requestRef.current = null;
  }, []);

  const open = useCallback((selectedMedia) => {
    cancel();
    latestMediaRef.current = selectedMedia;
    const controller = new AbortController();
    const request = { controller, selectedMedia };
    requestRef.current = request;
    setState({ status: 'loading', selectedMedia, media: null, error: null });

    getMediaDetails({
      provider: selectedMedia?.provider,
      type: typeForRequest(selectedMedia),
      providerId: selectedMedia?.providerId,
      includeAdult,
      signal: controller.signal
    })
      .then((media) => {
        if (requestRef.current !== request) return;
        requestRef.current = null;
        setState({ status: 'success', selectedMedia, media, error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted || requestRef.current !== request) return;
        requestRef.current = null;
        setState({ status: 'error', selectedMedia, media: null, error });
      });
  }, [cancel, includeAdult]);

  const retry = useCallback(() => {
    if (latestMediaRef.current) open(latestMediaRef.current);
  }, [open]);

  const close = useCallback(() => {
    cancel();
    latestMediaRef.current = null;
    setState(IDLE_STATE);
  }, [cancel]);

  useEffect(() => () => cancel(), [cancel]);
  useEffect(() => {
    if (includeAdultRef.current === includeAdult) return;
    includeAdultRef.current = includeAdult;
    if (latestMediaRef.current) open(latestMediaRef.current);
  }, [includeAdult, open]);

  return {
    ...state,
    state,
    open,
    retry,
    close,
    isBusy: state.status === 'loading'
  };
}
