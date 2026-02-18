import { useProvisioningStore } from '../store/provisioningStore';
import { stepNumber } from '../types/provisioning';

export function useProvisioning() {
  const step = useProvisioningStore((s) => s.step);
  const selectedNetwork = useProvisioningStore((s) => s.selectedNetwork);
  const scannedNetworks = useProvisioningStore((s) => s.scannedNetworks);
  const provisioningError = useProvisioningStore((s) => s.provisioningError);
  const connectionState = useProvisioningStore((s) => s.connectionState);
  const deviceName = useProvisioningStore((s) => s.deviceName);
  const wifiState = useProvisioningStore((s) => s.wifiState);
  const wifiIp = useProvisioningStore((s) => s.wifiIp);
  const wifiSsid = useProvisioningStore((s) => s.wifiSsid);
  const wifiRssi = useProvisioningStore((s) => s.wifiRssi);
  const wifiQuality = useProvisioningStore((s) => s.wifiQuality);
  const connectionFailed = useProvisioningStore((s) => s.connectionFailed);
  const pollError = useProvisioningStore((s) => s.pollError);
  const polling = useProvisioningStore((s) => s.polling);
  const busy = useProvisioningStore((s) => s.busy);

  const scanForDevices = useProvisioningStore((s) => s.provisioningScanForDevices);
  const connectToDevice = useProvisioningStore((s) => s.provisioningConnectToDevice);
  const scanWifiNetworks = useProvisioningStore((s) => s.provisioningScanWifiNetworks);
  const selectNetwork = useProvisioningStore((s) => s.provisioningSelectNetwork);
  const submitCredentials = useProvisioningStore((s) => s.provisioningSubmitCredentials);
  const retryConnection = useProvisioningStore((s) => s.provisioningRetryConnection);
  const deleteNetworkAndReturn = useProvisioningStore((s) => s.provisioningDeleteNetworkAndReturn);
  const goToNetworks = useProvisioningStore((s) => s.provisioningGoToNetworks);
  const goToManage = useProvisioningStore((s) => s.provisioningGoToManage);
  const reset = useProvisioningStore((s) => s.provisioningReset);

  return {
    step,
    stepNumber: stepNumber(step),
    selectedNetwork,
    scannedNetworks,
    provisioningError,
    connectionState,
    deviceName,
    wifiState,
    wifiIp,
    wifiSsid,
    wifiRssi,
    wifiQuality,
    connectionFailed,
    pollError,
    polling,
    busy,

    scanForDevices,
    connectToDevice,
    scanWifiNetworks,
    selectNetwork,
    submitCredentials,
    retryConnection,
    deleteNetworkAndReturn,
    goToNetworks,
    goToManage,
    reset,
  };
}
