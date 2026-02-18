import { useProvisioningStore } from '../store/provisioningStore';

export function useBleConnection() {
  const connectionState = useProvisioningStore((s) => s.connectionState);
  const deviceName = useProvisioningStore((s) => s.deviceName);
  const deviceId = useProvisioningStore((s) => s.deviceId);
  const bleError = useProvisioningStore((s) => s.bleError);

  const connectToDevice = useProvisioningStore((s) => s.connectToDevice);
  const disconnectDevice = useProvisioningStore((s) => s.disconnectDevice);

  return {
    connectionState,
    deviceName,
    deviceId,
    bleError,

    connectToDevice,
    disconnectDevice,
  };
}
