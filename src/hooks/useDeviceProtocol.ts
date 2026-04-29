/**
 * Direct access to every device command. Useful for headless / advanced
 * paths that need raw protocol calls outside the wizard flow.
 *
 * Each call is tracked: `loading` reflects whether ANY command from this
 * hook instance is in flight, and `error` holds the message of the most
 * recent failure. Both are scoped per-instance — they do NOT leak into
 * the wizard's `useProvisioning().error`.
 */

import { useCallback, useState } from 'react';

import { useProvisioningStore } from '../store/provisioningStore';
import type {
  AddNetworkParams,
  ApStatus,
  DeviceVariable,
  SavedNetwork,
  ScannedNetwork,
  StartApParams,
  WifiStatus,
} from '../types';

/**
 * @example
 * const { getStatus, setVar, loading, error } = useDeviceProtocol();
 * const status = await getStatus(); // throws on failure
 */
export function useDeviceProtocol() {
  const getStatusCmd = useProvisioningStore((s) => s.getStatus);
  const scanNetworksCmd = useProvisioningStore((s) => s.scanNetworks);
  const listNetworksCmd = useProvisioningStore((s) => s.listNetworks);
  const addNetworkCmd = useProvisioningStore((s) => s.addNetwork);
  const delNetworkCmd = useProvisioningStore((s) => s.delNetwork);
  const connectWifiCmd = useProvisioningStore((s) => s.connectWifi);
  const disconnectWifiCmd = useProvisioningStore((s) => s.disconnectWifi);
  const getApStatusCmd = useProvisioningStore((s) => s.getApStatus);
  const startApCmd = useProvisioningStore((s) => s.startAp);
  const stopApCmd = useProvisioningStore((s) => s.stopAp);
  const getVarCmd = useProvisioningStore((s) => s.getVar);
  const setVarCmd = useProvisioningStore((s) => s.setVar);
  const factoryResetCmd = useProvisioningStore((s) => s.factoryReset);

  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const track = useCallback(async <R>(promise: Promise<R>): Promise<R> => {
    setInFlight((c) => c + 1);
    setError(null);
    try {
      return await promise;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setInFlight((c) => c - 1);
    }
  }, []);

  const getStatus = useCallback(
    (): Promise<WifiStatus> => track(getStatusCmd()),
    [track, getStatusCmd],
  );
  const scanNetworks = useCallback(
    (): Promise<ScannedNetwork[]> => track(scanNetworksCmd()),
    [track, scanNetworksCmd],
  );
  const listNetworks = useCallback(
    (): Promise<SavedNetwork[]> => track(listNetworksCmd()),
    [track, listNetworksCmd],
  );
  const addNetwork = useCallback(
    (params: AddNetworkParams): Promise<void> => track(addNetworkCmd(params)),
    [track, addNetworkCmd],
  );
  const delNetwork = useCallback(
    (ssid: string): Promise<void> => track(delNetworkCmd(ssid)),
    [track, delNetworkCmd],
  );
  const connectWifi = useCallback(
    (ssid?: string): Promise<void> => track(connectWifiCmd(ssid)),
    [track, connectWifiCmd],
  );
  const disconnectWifi = useCallback(
    (): Promise<void> => track(disconnectWifiCmd()),
    [track, disconnectWifiCmd],
  );
  const getApStatus = useCallback(
    (): Promise<ApStatus> => track(getApStatusCmd()),
    [track, getApStatusCmd],
  );
  const startAp = useCallback(
    (params?: StartApParams): Promise<void> => track(startApCmd(params)),
    [track, startApCmd],
  );
  const stopAp = useCallback(
    (): Promise<void> => track(stopApCmd()),
    [track, stopApCmd],
  );
  const getVar = useCallback(
    (key: string): Promise<DeviceVariable> => track(getVarCmd(key)),
    [track, getVarCmd],
  );
  const setVar = useCallback(
    (key: string, value: string): Promise<void> =>
      track(setVarCmd(key, value)),
    [track, setVarCmd],
  );
  const factoryReset = useCallback(
    (): Promise<void> => track(factoryResetCmd()),
    [track, factoryResetCmd],
  );

  return {
    /** True while ANY command from this hook instance is in flight. */
    loading: inFlight > 0,
    /** Message of the most recent failed call from this hook, or null. */
    error,

    getStatus,
    scanNetworks,
    listNetworks,
    addNetwork,
    delNetwork,
    connectWifi,
    disconnectWifi,
    getApStatus,
    startAp,
    stopAp,
    getVar,
    setVar,
    factoryReset,
  };
}
