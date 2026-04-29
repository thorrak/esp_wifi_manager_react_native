/**
 * Live WiFi status from the device while the connection poller runs.
 *
 * Use during the `joiningWifi` step to render connection progress, RSSI,
 * IP address, etc. For terminal failure detection, read `error` from
 * `useProvisioning()` — this hook deliberately does not expose its own
 * error field.
 */

import { useProvisioningStore } from '../store/provisioningStore';

/**
 * @example
 * const { wifiState, wifiIp, polling } = useWifiStatus();
 */
export function useWifiStatus() {
  const wifiState = useProvisioningStore((s) => s.wifiState);
  const wifiSsid = useProvisioningStore((s) => s.wifiSsid);
  const wifiIp = useProvisioningStore((s) => s.wifiIp);
  const wifiRssi = useProvisioningStore((s) => s.wifiRssi);
  const wifiQuality = useProvisioningStore((s) => s.wifiQuality);
  const polling = useProvisioningStore((s) => s.polling);

  const pollOnce = useProvisioningStore((s) => s.pollOnce);

  return {
    wifiState,
    wifiSsid,
    wifiIp,
    wifiRssi,
    wifiQuality,
    polling,

    pollOnce,
  };
}
