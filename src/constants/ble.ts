/**
 * BLE-related constants for ESP-IDF Network Provisioning.
 *
 * On the firmware side (esp_wifi_config 0.2.x) everything about BLE
 * provisioning except the two enable flags is a *runtime* field on
 * `wifi_cfg_prov_config_t` (`config.prov_ble.*`) — there are no Kconfig
 * options for the device name, PoP, security version, or username. The
 * defaults below therefore mirror `examples/with_ble/main/main.c` in the
 * firmware repo, not a Kconfig default.
 */

/**
 * Default BLE GAP-name prefix to filter scans by.
 *
 * The firmware's `prov_ble.device_name` template defaults to `"PROV_{id}"`
 * (`{id}` = last three STA-MAC bytes as hex), so `"PROV_"` matches an
 * unmodified device. Override via `BleTransportConfig.deviceNamePrefix` if
 * your firmware sets its own template.
 */
export const DEVICE_NAME_PREFIX = 'PROV_';

/** Default BLE scan timeout (ms). */
export const DEFAULT_SCAN_TIMEOUT_MS = 10000;

/**
 * The proof-of-possession used by `examples/with_ble` in the firmware repo.
 *
 * **Not applied implicitly.** `BleTransportConfig.proofOfPossession` has no
 * default: leave it unset and the wizard prompts for it; pass `''` for a
 * device that runs Security 1 with no PoP (the firmware's own default when
 * `prov_ble.pop` is unset). This constant exists so apps targeting the
 * example firmware can write `proofOfPossession: DEFAULT_POP` explicitly.
 * Real devices should ship a unique, per-device PoP and use `promptForAuth`.
 */
export const DEFAULT_POP = 'abcd1234';

/**
 * Default SRP6a username for Security 2.
 *
 * Matches `examples/with_ble` in the firmware repo. The firmware has no
 * default here — the username is whatever the Security 2 salt + verifier
 * compiled into the device were derived from, and it never flows through
 * `wifi_prov_mgr`, so the app must know it out of band (config or
 * `promptForAuth`).
 */
export const DEFAULT_SECURITY2_USERNAME = 'wificfg';
