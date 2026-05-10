export type WifiAuthType =
  | 'OPEN'
  | 'WEP'
  | 'WPA'
  | 'WPA2'
  | 'WPA/WPA2'
  | 'WPA3'
  | 'WPA2/WPA3'
  | 'WPA2_ENTERPRISE'
  | 'UNKNOWN';

/**
 * One result from the SDK's `prov-scan` call. Mirrors what `ESPWifiList`
 * carries plus a normalised `auth` string for the UI.
 */
export interface ScannedNetwork {
  ssid: string;
  rssi: number;
  auth: WifiAuthType;
  bssid?: string;
  channel?: number;
}

/**
 * Outcome of a successful `provision()` call. The SDK returns just
 * `{ status: string }` — we surface that plus the SSID we sent so UIs
 * have a stable place to read both.
 */
export interface ProvisionResult {
  ssid: string;
  status: string;
}
