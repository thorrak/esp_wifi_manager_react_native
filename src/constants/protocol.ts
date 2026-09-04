/**
 * Custom protocomm endpoint paths registered by esp_wifi_config 0.2.0+.
 *
 * These run alongside the standard `prov-config` / `prov-scan` endpoints
 * the SDK uses internally — see `src/esp_wifi_config_prov_ble.c` on the
 * firmware side for the schemas they accept and return. All five are
 * always registered (no feature flag); `esp-wifi-config-network-info` is
 * only *reachable* on 0.2.0+ (0.1.0 registered it without creating the
 * GATT characteristic).
 */
export const PROV_ENDPOINT_VERSION = 'esp-wifi-config-version';
export const PROV_ENDPOINT_CAPABILITIES = 'esp-wifi-config-capabilities';
export const PROV_ENDPOINT_VARS = 'esp-wifi-config-vars';
export const PROV_ENDPOINT_NETWORK_POLICY = 'esp-wifi-config-network-policy';
export const PROV_ENDPOINT_NETWORK_INFO = 'esp-wifi-config-network-info';

/** Default timeout for a custom-endpoint round-trip (ms). */
export const DEFAULT_ENDPOINT_TIMEOUT_MS = 8000;

/** Default timeout for the WiFi scan / prov-scan endpoint (ms). */
export const DEFAULT_WIFI_SCAN_TIMEOUT_MS = 15000;

/**
 * Default timeout for a full provision() call — credential exchange plus
 * the device's STA-connect attempt.
 *
 * Size this against the firmware's `prov_ble.wifi_conn_attempts`: with the
 * default (0) a wrong password fails on the first STA disconnect, but a
 * bounded value of N makes the device retry N times before reporting
 * failure, and each retry can take several seconds.
 */
export const DEFAULT_PROVISION_TIMEOUT_MS = 60000;
