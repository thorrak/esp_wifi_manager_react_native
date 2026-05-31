/**
 * Protocol-layer types for the custom protocomm endpoints exposed by
 * esp_wifi_config 0.1.0+.
 *
 * The library no longer sends raw JSON commands over GATT — credential
 * exchange and the WiFi scan list are routed through the SDK's
 * `provision()` / `scanWifiList()`. What remains here is the small set of
 * library-specific protocomm endpoints used to expose higher-level state
 * during the provisioning window.
 */

export interface DeviceVersionInfo {
  lib?: string;
  idf?: string;
  app?: string;
  fw_version?: string;
  compile_time?: string;
  chip?: string;
  firmware_version?: string;
  /** Catch-all for forward-compat fields. */
  [key: string]: unknown;
}

export interface DeviceCapabilities {
  capabilities: string[];
  max_networks?: number;
  max_vars?: number;
  /** Catch-all for forward-compat fields. */
  [key: string]: unknown;
}

export interface DeviceVariable {
  key: string;
  value: string;
}

export interface DeviceNetworkPolicy {
  provisioning_mode?: string;
  max_retry_per_network?: number;
  retry_interval_ms?: number;
  retry_max_interval_ms?: number;
  auto_reconnect?: boolean;
  max_reconnect_attempts?: number;
  saved_networks?: number;
  /** Catch-all for forward-compat fields. */
  [key: string]: unknown;
}

/**
 * Station network details from `esp-wifi-config-network-info`, read right
 * after a successful provision() to surface the device's assigned IP without
 * an extra round-trip over Wi-Fi.
 *
 * While the device is still associating (IP not yet assigned) the firmware
 * returns only `{ connected: false }`, so every other field is optional.
 */
export interface DeviceNetworkInfo {
  /** True once the station has an IP. When false, treat the rest as absent. */
  connected: boolean;
  ssid?: string;
  /** IPv4 address, e.g. "192.168.1.100". */
  ip?: string;
  netmask?: string;
  gateway?: string;
  dns?: string;
  /** Station MAC, colon-delimited uppercase. */
  mac?: string;
  /** Connected AP BSSID, colon-delimited uppercase. */
  bssid?: string;
  hostname?: string;
  /** Signal strength in dBm (negative). */
  rssi?: number;
  /** Signal quality 0–100%. */
  quality?: number;
  channel?: number;
  /** Milliseconds since the station connected. */
  uptime_ms?: number;
  /** Catch-all for forward-compat fields. */
  [key: string]: unknown;
}

/** Vars endpoint request union. See firmware schema in esp_wifi_config_prov_ble.c. */
export type VarsRequest =
  | { op: 'list' }
  | { op: 'get'; key: string }
  | { op: 'set'; key: string; value: string }
  | { op: 'del'; key: string };

export interface VarsListResponse {
  vars: Array<{ k: string; v: string }>;
}

export interface VarsGetResponse {
  key: string;
  value: string;
}

export interface VarsOkResponse {
  ok: true;
}

export interface VarsErrorResponse {
  error: string;
  ok?: false;
}

export type VarsResponse =
  | VarsListResponse
  | VarsGetResponse
  | VarsOkResponse
  | VarsErrorResponse;

export interface DeviceProtocolEvents {
  busyChanged: (busy: boolean) => void;
  endpointError: (error: Error, endpoint: string) => void;
}

export interface DeviceProtocolConfig {
  /** Default per-endpoint timeout in ms. Default: 8000. */
  defaultTimeoutMs?: number;
  /** Per-endpoint timeout overrides keyed by endpoint path. */
  endpointTimeouts?: Record<string, number>;
}
