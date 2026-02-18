import { useProvisioningStore } from '../store/provisioningStore';

export function useDeviceScanner() {
  const discoveredDevices = useProvisioningStore((s) => s.discoveredDevices);
  const scanning = useProvisioningStore((s) => s.scanning);

  const startScan = useProvisioningStore((s) => s.startScan);
  const stopScan = useProvisioningStore((s) => s.stopScan);

  return {
    discoveredDevices,
    scanning,

    startScan,
    stopScan,
  };
}
