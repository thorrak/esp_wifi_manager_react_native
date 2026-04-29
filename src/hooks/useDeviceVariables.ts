/**
 * Convenience hook for reading and writing device variables (key/value
 * application config exposed by the firmware via `get_var`/`set_var`).
 *
 * Returns null/false on error rather than throwing — easier to use from
 * effects without try/catch. The most recent error message is exposed via
 * `error`. `loading` reflects whether ANY call from this hook instance is
 * in flight (per-instance counter, NOT a global busy flag).
 */

import { useCallback, useState } from 'react';

import { useProvisioningStore } from '../store/provisioningStore';
import type { DeviceVariable } from '../types';

/**
 * @example
 * const { getVariable, setVariable, loading, error } = useDeviceVariables();
 * const v = await getVariable('mdns_name');
 * await setVariable('mdns_name', 'my-device');
 */
export function useDeviceVariables() {
  const getVarCmd = useProvisioningStore((s) => s.getVar);
  const setVarCmd = useProvisioningStore((s) => s.setVar);

  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const getVariable = useCallback(
    async (key: string): Promise<DeviceVariable | null> => {
      setInFlight((c) => c + 1);
      setError(null);
      try {
        return await getVarCmd(key);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return null;
      } finally {
        setInFlight((c) => c - 1);
      }
    },
    [getVarCmd],
  );

  const setVariable = useCallback(
    async (key: string, value: string): Promise<boolean> => {
      setInFlight((c) => c + 1);
      setError(null);
      try {
        await setVarCmd(key, value);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setInFlight((c) => c - 1);
      }
    },
    [setVarCmd],
  );

  return {
    /** True while ANY get/set call from this hook instance is in flight. */
    loading: inFlight > 0,
    /** Message of the most recent failed call, or null. */
    error,

    getVariable,
    setVariable,
  };
}
