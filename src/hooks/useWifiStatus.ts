import { useProvisioningStore } from '../store/provisioningStore';

export function useWifiStatus() {
  const wifiState = useProvisioningStore((s) => s.wifiState);
  const wifiSsid = useProvisioningStore((s) => s.wifiSsid);
  const wifiIp = useProvisioningStore((s) => s.wifiIp);
  const wifiRssi = useProvisioningStore((s) => s.wifiRssi);
  const wifiQuality = useProvisioningStore((s) => s.wifiQuality);
  const polling = useProvisioningStore((s) => s.polling);
  const pollError = useProvisioningStore((s) => s.pollError);
  const connectionFailed = useProvisioningStore((s) => s.connectionFailed);

  const pollOnce = useProvisioningStore((s) => s.pollOnce);

  return {
    wifiState,
    wifiSsid,
    wifiIp,
    wifiRssi,
    wifiQuality,
    polling,
    pollError,
    connectionFailed,

    pollOnce,
  };
}
