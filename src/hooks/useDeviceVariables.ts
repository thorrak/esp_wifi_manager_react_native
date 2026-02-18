import { useState, useCallback } from 'react';
import type { DeviceVariable } from '../types';
import { useDeviceProtocol } from './useDeviceProtocol';

export function useDeviceVariables() {
  const { getVar, setVar } = useDeviceProtocol();

  const [error, setError] = useState<string | null>(null);

  const getVariable = useCallback(
    async (key: string): Promise<DeviceVariable | null> => {
      setError(null);
      try {
        const result = await getVar(key);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      }
    },
    [getVar],
  );

  const setVariable = useCallback(
    async (key: string, value: string): Promise<boolean> => {
      setError(null);
      try {
        await setVar(key, value);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [setVar],
  );

  return {
    error,

    getVariable,
    setVariable,
  };
}
