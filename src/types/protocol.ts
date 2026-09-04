/**
 * Protocol-layer types for the five custom protocomm endpoints exposed by
 * esp_wifi_config 0.2.0+ (`esp-wifi-config-version`, `-capabilities`,
 * `-vars`, `-network-policy`, `-network-info`).
 *
 * The library no longer sends raw JSON commands over GATT — credential
 * exchange and the WiFi scan list are routed through the SDK's
 * `provision()` / `scanWifiList()`. What remains here is the small set of
 * library-specific protocomm endpoints used to expose higher-level state
 * during the provisioning window. Schemas mirror
 * `src/esp_wifi_config_prov_ble.c` in the firmware repo.
 */

export interface DeviceVersionInfo {
  /**
   * Library banner string. On esp_wifi_config 0.1.0–0.2.3 this is
   * hardcoded to `"esp_wifi_config 0.1.0"` regardless of the actual
   * component version — do not gate behaviour on it. Use `fw_version`
   * (the app's `esp_app_desc_t.version`) or `firmware_version` (set by
   * the app via `prov_ble.firmware_version`) instead.
   */
  lib?: string;
  /** ESP-IDF version string (`IDF_VER`). */
  idf?: string;
  /** Application project name (`esp_app_desc_t.project_name`). */
  app?: string;
  /** Application version (`esp_app_desc_t.version`). */
  fw_version?: string;
  /** Application compile time (`esp_app_desc_t.time`). */
  compile_time?: string;
  /** Chip variant: `esp32`, `esp32s2`, `esp32s3`, `esp32c3`, `esp32c6`, `esp32h2`, or `unknown`. */
  chip?: string;
  /** Optional app-supplied version from `prov_ble.firmware_version`; absent if unset. */
  firmware_version?: string;
  /** Catch-all for forward-compat fields. */
  [key: string]: unknown;
}

/**
 * Feature flags the firmware may report in `DeviceCapabilities.capabilities`.
 * `multi-network` and `custom-vars` are always present; the rest depend on
 * the firmware's Kconfig (`improv-serial`, `webui`, `cli`) or runtime config
 * (`softap` ⇔ `config.enable_ap`). Typed loosely so new flags don't break
 * older clients.
 */
export type DeviceCapability =
  | 'multi-network'
  | 'custom-vars'
  | 'improv-serial'
  | 'webui'
  | 'cli'
  | 'softap';

export interface DeviceCapabilities {
  capabilities: Array<DeviceCapability | (string & {})>;
  /** `WIFI_CFG_MAX_NETWORKS` — saved-network slots on the device. */
  max_networks?: number;
  /** `WIFI_CFG_MAX_VARS` — custom-variable slots on the device. */
  max_vars?: number;
  /** Catch-all for forward-compat fields. */
  [key: string]: unknown;
}

export interface DeviceVariable {
  key: string;
  value: string;
}

/**
 * `provisioning_mode` as reported by `esp-wifi-config-network-policy`. The
 * firmware always sends the *name*, never the enum's numeric value, so the
 * 0.2.0 renumbering of `wifi_provisioning_mode_t` is invisible here.
 */
export type DeviceProvisioningMode =
  | 'always'
  | 'on_failure'
  | 'when_unprovisioned'
  | 'manual'
  | 'unknown';

export interface DeviceNetworkPolicy {
  provisioning_mode?: DeviceProvisioningMode | (string & {});
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
 * Requires esp_wifi_config **0.2.0+**: on 0.1.0 the endpoint handler was
 * registered but its GATT characteristic was never created, so every call
 * failed and `waitForNetworkInfo()` resolved `null`.
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
