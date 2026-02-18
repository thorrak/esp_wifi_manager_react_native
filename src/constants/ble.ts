/** Full 128-bit UUID for the WiFi Manager BLE service */
export const SERVICE_UUID = '0000FFE0-0000-1000-8000-00805F9B34FB';

/** Status characteristic - Read, Notify */
export const STATUS_CHAR_UUID = '0000FFE1-0000-1000-8000-00805F9B34FB';

/** Command characteristic - Write */
export const COMMAND_CHAR_UUID = '0000FFE2-0000-1000-8000-00805F9B34FB';

/** Response characteristic - Read, Notify */
export const RESPONSE_CHAR_UUID = '0000FFE3-0000-1000-8000-00805F9B34FB';

/** Default device name prefix for BLE scanning */
export const DEVICE_NAME_PREFIX = 'ESP32-WiFi-';

/** Minimum delay between GATT writes (ms) to avoid "operation in progress" errors */
export const GATT_SETTLE_MS = 120;

/** Default scan timeout (ms) */
export const DEFAULT_SCAN_TIMEOUT_MS = 15000;

/** Default connection timeout (ms) */
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;

/** Default MTU to request from the device */
export const DEFAULT_REQUESTED_MTU = 517;
