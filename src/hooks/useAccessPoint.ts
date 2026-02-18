import { useState, useEffect, useCallback } from 'react';
import type { ApStatus, StartApParams } from '../types';
import { useDeviceProtocol } from './useDeviceProtocol';

export function useAccessPoint() {
  const {
    getApStatus: getApStatusCmd,
    startAp: startApCmd,
    stopAp: stopApCmd,
  } = useDeviceProtocol();

  const [apStatus, setApStatus] = useState<ApStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchApStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getApStatusCmd();
      setApStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [getApStatusCmd]);

  const startAp = useCallback(
    async (params?: StartApParams) => {
      setError(null);
      try {
        await startApCmd(params);
        await fetchApStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [startApCmd, fetchApStatus],
  );

  const stopAp = useCallback(async () => {
    setError(null);
    try {
      await stopApCmd();
      await fetchApStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [stopApCmd, fetchApStatus]);

  useEffect(() => {
    fetchApStatus();
  }, [fetchApStatus]);

  return {
    apStatus,
    loading,
    error,

    fetchApStatus,
    startAp,
    stopAp,
  };
}
