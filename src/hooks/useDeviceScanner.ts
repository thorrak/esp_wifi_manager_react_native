/**
 * Thin selector over BLE scan state. Useful when you only want to render a
 * device list and don't need the full provisioning state machine.
 *
 * For BLE-level errors, prefer `useProvisioning().error` (filtered to
 * `error.source === 'ble'`) — this hook intentionally does not expose its
 * own error field so consumers don't have to merge multiple error sources.
 */

import { useProvisioningStore } from '../store/provisioningStore';

/**
 * Reactive view of the current BLE scan: discovered devices, scanning flag,
 * and last-scan diagnostics.
 *
 * @example
 * const { discoveredDevices, scanning, lastScanResult } = useDeviceScanner();
 */
export function useDeviceScanner() {
  const discoveredDevices = useProvisioningStore((s) => s.discoveredDevices);
  const scanning = useProvisioningStore((s) => s.scanning);
  const lastScanResult = useProvisioningStore((s) => s.lastScanResult);

  return {
    discoveredDevices,
    scanning,
    lastScanResult,
  };
}
