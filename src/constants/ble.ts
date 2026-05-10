/**
 * BLE-related constants for ESP-IDF Network Provisioning.
 *
 * The previous custom 0xFFE0 GATT service is gone — wifi_prov_mgr derives
 * its BLE service UUID from a per-device prefix (default 16-byte UUID,
 * configurable via CONFIG_WIFI_CFG_NETWORK_PROVISIONING_SERVICE_PREFIX).
 * The Espressif native SDK handles the BLE I/O for us, so we no longer
 * expose any GATT UUIDs from this library.
 */

/** Default BLE GAP-name prefix that wifi_prov_scheme_ble advertises with. */
export const DEVICE_NAME_PREFIX = 'PROV_';

/** Default BLE scan timeout (ms). */
export const DEFAULT_SCAN_TIMEOUT_MS = 10000;

/** Default per-call SDK operation timeout (ms). */
export const DEFAULT_SDK_TIMEOUT_MS = 15000;

/**
 * Default proof-of-possession for Security 1.
 *
 * Matches the firmware's Kconfig default
 * (CONFIG_WIFI_CFG_NETWORK_PROVISIONING_POP). Real devices should ship
 * with a unique, per-device PoP — override at runtime via
 * `ProvisioningConfig.security.proofOfPossession`.
 */
export const DEFAULT_POP = 'abcd1234';

/**
 * Default SRP6a username for Security 2 (matches firmware Kconfig
 * default `CONFIG_WIFI_CFG_NETWORK_PROVISIONING_SECURITY2_USERNAME`).
 */
export const DEFAULT_SECURITY2_USERNAME = 'wificfg';
