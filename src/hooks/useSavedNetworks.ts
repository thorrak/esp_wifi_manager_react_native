/**
 * Convenience hook for the device's saved-network list (those persisted in
 * the device's flash). Auto-fetches on mount.
 *
 * Use on the `manage` screen. Inside the wizard, the manager handles
 * `add_network` / `del_network` directly.
 */

import { useState, useEffect, useCallback } from 'react';
import type { SavedNetwork } from '../types';
import { useDeviceProtocol } from './useDeviceProtocol';

/**
 * @example
 * const { networks, fetchNetworks, deleteNetwork, loading, error } =
 *   useSavedNetworks();
 */
export function useSavedNetworks() {
  const { listNetworks, delNetwork } = useDeviceProtocol();

  const [networks, setNetworks] = useState<SavedNetwork[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNetworks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listNetworks();
      setNetworks(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [listNetworks]);

  const deleteNetwork = useCallback(
    async (ssid: string) => {
      setError(null);
      try {
        await delNetwork(ssid);
        await fetchNetworks();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [delNetwork, fetchNetworks],
  );

  useEffect(() => {
    fetchNetworks();
  }, [fetchNetworks]);

  return {
    networks,
    loading,
    error,

    fetchNetworks,
    deleteNetwork,
  };
}
