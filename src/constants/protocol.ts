/**
 * Custom protocomm endpoint paths registered by esp_wifi_config 0.1.0+.
 *
 * These run alongside the standard `prov-config` / `prov-scan` endpoints
 * the SDK uses internally — see esp_wifi_config_prov_ble.c on the
 * firmware side for the schemas they accept and return.
 */
export const PROV_ENDPOINT_VERSION = 'esp-wifi-config-version';
export const PROV_ENDPOINT_CAPABILITIES = 'esp-wifi-config-capabilities';
export const PROV_ENDPOINT_VARS = 'esp-wifi-config-vars';
export const PROV_ENDPOINT_NETWORK_POLICY = 'esp-wifi-config-network-policy';

/** Default timeout for a custom-endpoint round-trip (ms). */
export const DEFAULT_ENDPOINT_TIMEOUT_MS = 8000;

/** Default timeout for the WiFi scan / prov-scan endpoint (ms). */
export const DEFAULT_WIFI_SCAN_TIMEOUT_MS = 15000;

/**
 * Default timeout for a full provision() call — credential exchange plus
 * the device's STA-connect attempt.
 */
export const DEFAULT_PROVISION_TIMEOUT_MS = 60000;
