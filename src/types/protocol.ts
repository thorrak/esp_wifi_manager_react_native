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
