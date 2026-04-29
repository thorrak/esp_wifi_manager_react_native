/**
 * Thin selector over BLE connection state. Returns the unified `device`
 * shape from the store; `device.status` discriminates `'connecting'` vs
 * `'connected'` vs `null` (idle).
 *
 * This hook does NOT expose connect/disconnect actions — connection is
 * driven by the wizard via `useProvisioning().chooseDevice`. For headless
 * use, instantiate `BleTransport` directly.
 */

import { useProvisioningStore } from '../store/provisioningStore';

/**
 * @example
 * const { device } = useBleConnection();
 * if (device?.status === 'connected') { ... }
 */
export function useBleConnection() {
  const device = useProvisioningStore((s) => s.device);
  return { device };
}
