import { useProvisioningStore } from '../store/provisioningStore';

export function useDeviceScanner() {
  const discoveredDevices = useProvisioningStore((s) => s.discoveredDevices);
  const scanning = useProvisioningStore((s) => s.scanning);
  const bleError = useProvisioningStore((s) => s.bleError);
  const bleErrorCode = useProvisioningStore((s) => s.bleErrorCode);

  const startScan = useProvisioningStore((s) => s.startScan);
  const stopScan = useProvisioningStore((s) => s.stopScan);

  return {
    discoveredDevices,
    scanning,
    bleError,
    bleErrorCode,

    startScan,
    stopScan,
  };
}
