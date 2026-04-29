# Bluetooth Provisioning Workflow

This document describes the BLE GATT provisioning interface exposed by `esp_wifi_config`. It covers the service architecture, configuration requirements, command protocol, lifecycle management, and implications for subsequent application-level BLE usage.

---

## Table of Contents

- [GATT Service Architecture](#gatt-service-architecture)
- [Configuration & Activation](#configuration--activation)
- [Command Protocol](#command-protocol)
- [Provisioning Session Walkthrough](#provisioning-session-walkthrough)
- [Deactivation & Cleanup](#deactivation--cleanup)
- [Implications for Subsequent BLE Usage](#implications-for-subsequent-ble-usage)

---

## GATT Service Architecture

### Service

| Field        | Value                                  |
|--------------|----------------------------------------|
| Service UUID | `0xFFE0` (`0000FFE0-0000-1000-8000-00805F9B34FB`) |
| Instance ID  | 0                                      |

### Characteristics

The service exposes three characteristics:

| Name     | UUID     | Properties     | Max Size | Purpose                        |
|----------|----------|----------------|----------|--------------------------------|
| Status   | `0xFFE1` | Read, Notify   | 512 B    | Current WiFi status (JSON)     |
| Command  | `0xFFE2` | Write          | 512 B    | Receives JSON commands         |
| Response | `0xFFE3` | Read, Notify   | 512 B    | Sends JSON command responses   |

Both Status (`0xFFE1`) and Response (`0xFFE3`) have Client Characteristic Configuration Descriptors (CCCDs) for enabling notifications. Command (`0xFFE2`) uses `ESP_GATT_RSP_BY_APP` — the firmware generates write acknowledgements explicitly.

### Attribute Table Layout

```
Index  Type                      UUID/Role
─────  ────────────────────────  ─────────────────────
0      Primary Service Decl.     0xFFE0
1      Characteristic Decl.      Status
2      Characteristic Value      0xFFE1 (R/N)
3      CCCD                      Status notifications
4      Characteristic Decl.      Command
5      Characteristic Value      0xFFE2 (W)
6      Characteristic Decl.      Response
7      Characteristic Value      0xFFE3 (R/N)
8      CCCD                      Response notifications
```

Total: 9 attributes (`WIFI_IDX_NB`).

### Advertising

The device advertises with:

- **Name**: Configurable at runtime via the `device_name` field of `wifi_cfg_ble_config_t` (default: `"ESP32-WiFi-{id}"` where `{id}` expands to the last 3 bytes of the MAC address, e.g. `"ESP32-WiFi-A1B2C3"`)
- **Flags**: General Discoverable + BR/EDR Not Supported
- **Advertising interval**: 20ms–40ms (`0x20`–`0x40` in 0.625ms units)
- **Type**: Connectable undirected (`ADV_TYPE_IND`)
- **Channels**: All three advertising channels
- **Filter**: Allow scan and connection from any device

The service UUID is **not** included in the advertising payload — clients must connect and discover services, or filter by device name prefix.

### Connection Parameters

On connect, the firmware requests updated connection parameters for better throughput:

| Parameter    | Value          |
|-------------|----------------|
| Min interval | 0x10 (20ms)   |
| Max interval | 0x20 (40ms)   |
| Latency      | 0              |
| Timeout      | 400 (4000ms)  |

The local MTU is set to 517 (the BLE maximum). Actual negotiated MTU depends on the client.

---

## Configuration & Activation

### Compile-Time Requirements (sdkconfig / Kconfig)

BLE support is conditionally compiled. The build system selects the appropriate stack backend automatically based on the enabled host stack:

```cmake
if(CONFIG_BT_ENABLED AND (CONFIG_WIFI_CFG_ENABLE_CUSTOM_BLE OR CONFIG_WIFI_CFG_ENABLE_IMPROV_BLE))
    # Shared layer: JSON command routing and protocol handling
    target_sources(${lib} PRIVATE "src/esp_wifi_config_ble.c")
    # Stack-specific backend (exactly one is compiled)
    if(CONFIG_BT_BLUEDROID_ENABLED)
        target_sources(${lib} PRIVATE "src/esp_wifi_config_ble_bluedroid.c")
    elseif(CONFIG_BT_NIMBLE_ENABLED)
        target_sources(${lib} PRIVATE "src/esp_wifi_config_ble_nimble.c")
    endif()
    target_link_libraries(${lib} PRIVATE ${bt_lib})
endif()
```

Required sdkconfig flags — choose **one** host stack:

**Bluedroid** (~100KB flash / ~40KB RAM):
```ini
CONFIG_BT_ENABLED=y
CONFIG_BT_BLUEDROID_ENABLED=y
CONFIG_BT_CLASSIC_ENABLED=n             # Recommended if not using BT Classic — saves ~30KB RAM
CONFIG_BT_BLE_42_FEATURES_SUPPORTED=y   # Required for MTU negotiation
```

**NimBLE** (~50KB flash / ~20KB RAM):
```ini
CONFIG_BT_ENABLED=y
CONFIG_BT_NIMBLE_ENABLED=y
CONFIG_BT_NIMBLE_HOST_TASK_STACK_SIZE=6144
```

Common to both stacks:
```ini
# WiFi Config custom BLE interface
CONFIG_WIFI_CFG_ENABLE_CUSTOM_BLE=y

# Partition table — BLE + WiFi needs more flash
CONFIG_PARTITION_TABLE_SINGLE_APP_LARGE=y   # Recommended for 4MB+ flash
```

### Runtime Configuration

BLE is enabled at compile time via Kconfig. The runtime config struct only carries the device name:

```c
wifi_cfg_config_t config = {
    // ... other fields ...
    .ble = {
        .device_name = NULL,   // NULL → uses built-in default "ESP32-WiFi-{id}"
    },
};

wifi_cfg_init(&config);
```

The `wifi_cfg_ble_config_t` struct:

```c
typedef struct {
    const char *device_name;    ///< BLE device name (supports {id} placeholder)
} wifi_cfg_ble_config_t;
```

If `.device_name` is `NULL` or empty, the built-in default is used. The `{id}` placeholder is expanded by `wifi_cfg_expand_template()` to the last 3 bytes of the device's MAC address.

### Initialization Sequence

The BLE implementation is split into two layers:

- **Shared layer** (`esp_wifi_config_ble.c`) — JSON command routing, response chunking, and the public `wifi_cfg_ble_init()`/`wifi_cfg_ble_deinit()` API
- **Stack backend** — one of `esp_wifi_config_ble_bluedroid.c` or `esp_wifi_config_ble_nimble.c`, selected at compile time

When `wifi_cfg_init()` is called with BLE enabled, `wifi_cfg_ble_init()` executes:

1. **Expand device name template** — resolves `{id}` placeholder via `wifi_cfg_expand_template()`
2. **Delegate to the stack backend** — calls `wifi_cfg_ble_backend_init(device_name)`

The backend then initializes the BT controller, host stack, registers the GATT service, and begins advertising. The exact sequence differs by stack but the result is the same: the `0xFFE0` service is discoverable and accepting connections.

### Timing Within Manager Lifecycle

BLE initialization happens during `wifi_cfg_init()`, after HTTP and CLI setup but before the manager task is created. BLE is **not** tied to AP mode — it runs continuously from init to deinit, regardless of WiFi connection state.

### What's Running After Activation

Once initialized, the BLE interface is self-contained and event-driven. **No ongoing maintenance is required.** The stack backend handles all BLE events automatically:

- Advertising restarts automatically after a client disconnects
- Commands are dispatched through the shared JSON router via the backend callback `wifi_cfg_ble_on_command()`
- The NimBLE backend uses a dedicated FreeRTOS task and queue for command processing (to keep long-running operations like WiFi scan off the NimBLE host task); the Bluedroid backend processes commands in its GATTS write handler

The only resource consumed during idle (no client connected) is the BLE advertising, which runs in the BT controller with no CPU involvement.

---

## Command Protocol

### Message Format

**Commands** are written as UTF-8 JSON to the Command characteristic (`0xFFE2`):

```json
{
  "cmd": "<command_name>",
  "params": { ... }
}
```

The `params` field is optional — commands that take no parameters can omit it entirely.

**Responses** are sent as notifications on the Response characteristic (`0xFFE3`):

```json
{
  "status": "ok",
  "data": { ... }
}
```

Or on error:

```json
{
  "status": "error",
  "error": "<error_message>"
}
```

Responses longer than a single BLE notification are automatically chunked — the firmware splits the JSON across multiple notifications, each sized to fit within the negotiated MTU (minus 3 bytes for the ATT header). The client must buffer incoming notifications and reassemble the full JSON string (the response is complete when the accumulated data ends with `}`). A 20ms delay is inserted between chunks to avoid flooding the BLE controller's TX queue.

### Commands Reference

#### `get_status` — Get WiFi connection status

**Parameters:** None

**Response:**
```json
{
  "status": "ok",
  "data": {
    "state": "connected",       // "connected" | "connecting" | "disconnected"
    "ssid": "MyNetwork",
    "rssi": -45,
    "quality": 90,              // 0–100 percentage
    "ip": "192.168.1.100",
    "channel": 6,
    "netmask": "255.255.255.0",
    "gateway": "192.168.1.1",
    "dns": "192.168.1.1",
    "mac": "AA:BB:CC:DD:EE:FF",
    "hostname": "esp32-aabbcc",
    "uptime_ms": 123456,
    "ap_active": false
  }
}
```

#### `scan` — Scan for WiFi networks

**Parameters:** None

**Response:**
```json
{
  "status": "ok",
  "data": {
    "networks": [
      {"ssid": "MyNetwork", "rssi": -45, "auth": "WPA2"},
      {"ssid": "Office",    "rssi": -60, "auth": "WPA/WPA2"}
    ]
  }
}
```

Auth values: `"OPEN"`, `"WEP"`, `"WPA"`, `"WPA2"`, `"WPA/WPA2"`, `"WPA3"`, `"UNKNOWN"`

This is a blocking call (3–5 seconds). Returns up to `CONFIG_WIFI_CFG_MAX_SCAN_RESULTS` networks (default 20).

#### `list_networks` — List saved networks

**Parameters:** None

**Response:**
```json
{
  "status": "ok",
  "data": {
    "networks": [
      {"ssid": "MyNetwork", "priority": 10},
      {"ssid": "Backup",    "priority": 5}
    ]
  }
}
```

#### `add_network` — Save a WiFi network

**Parameters:**

| Key        | Type   | Required | Default | Description              |
|------------|--------|----------|---------|--------------------------|
| `ssid`     | string | yes      | —       | Network SSID             |
| `password` | string | no       | `""`    | Network password         |
| `priority` | number | no       | `10`    | Priority (higher = preferred) |

**Example:**
```json
{"cmd": "add_network", "params": {"ssid": "MyNetwork", "password": "secret", "priority": 10}}
```

**Response:** `{"status": "ok", "data": {}}`

#### `del_network` — Remove a saved network

**Parameters:**

| Key    | Type   | Required | Description |
|--------|--------|----------|-------------|
| `ssid` | string | yes      | SSID to remove |

**Example:**
```json
{"cmd": "del_network", "params": {"ssid": "OldNetwork"}}
```

**Response:** `{"status": "ok", "data": {}}`

**Errata:** As of Feb 17, 2026 deleting the currently active network does NOT disconnect from it. See https://github.com/thorrak/esp_wifi_config/issues/10 for discussion.

#### `connect` — Connect to WiFi

**Parameters:**

| Key    | Type   | Required | Description                               |
|--------|--------|----------|-------------------------------------------|
| `ssid` | string | no       | Specific SSID. If omitted, auto-connects to highest priority saved network. |

**Example:**
```json
{"cmd": "connect", "params": {"ssid": "MyNetwork"}}
```
or simply:
```json
{"cmd": "connect"}
```

**Response:** `{"status": "ok", "data": {}}` — connection happens asynchronously. Poll `get_status` to monitor progress.

#### `disconnect` — Disconnect from WiFi

**Parameters:** None

**Response:** `{"status": "ok", "data": {}}`

**Note:** Disconnecting from a network does not delete it from the list of available networks

#### `get_ap_status` — Get SoftAP status

**Parameters:** None

**Response:**
```json
{
  "status": "ok",
  "data": {
    "active": true,
    "ssid": "ESP32-Config",
    "ip": "192.168.4.1",
    "sta_count": 1
  }
}
```

#### `start_ap` — Start SoftAP mode

**Parameters (all optional):**

| Key        | Type   | Description                          |
|------------|--------|--------------------------------------|
| `ssid`     | string | Override AP SSID (uses saved config if omitted) |
| `password` | string | Override AP password                 |

**Response:** `{"status": "ok", "data": {}}`

#### `stop_ap` — Stop SoftAP mode

**Parameters:** None

**Response:** `{"status": "ok", "data": {}}`

#### `get_var` — Get a custom variable

**Parameters:**

| Key   | Type   | Required | Description  |
|-------|--------|----------|--------------|
| `key` | string | yes      | Variable key |

**Response:**
```json
{
  "status": "ok",
  "data": {
    "key": "device_name",
    "value": "My Device"
  }
}
```

#### `set_var` — Set a custom variable

**Parameters:**

| Key     | Type   | Required | Description    |
|---------|--------|----------|----------------|
| `key`   | string | yes      | Variable key   |
| `value` | string | yes      | Variable value |

**Response:** `{"status": "ok", "data": {}}`

#### `factory_reset` — Erase all saved data

**Parameters:** None

**Response:** `{"status": "ok", "data": {}}`

Erases all NVS data (saved networks, variables, AP config, auth credentials).

### Error Responses

| Error Message       | Cause                                      |
|---------------------|--------------------------------------------|
| `"Invalid JSON"`    | Command characteristic received malformed JSON |
| `"Missing cmd"`     | JSON object has no `"cmd"` field           |
| `"Unknown command"` | Unrecognized command name                  |
| `"Command failed"`  | Command handler returned NULL (operation failed) |

---

## Provisioning Session Walkthrough

A typical provisioning flow from a BLE client:

```
CLIENT                                     ESP32
  │                                          │
  │── BLE Scan ─────────────────────────────>│
  │<─ Advertisement: "ESP32-WiFi-A1B2C3" ───│
  │                                          │
  │── Connect ──────────────────────────────>│
  │<─ Connection Complete ──────────────────│
  │                                          │  (connection params updated)
  │                                          │
  │── Enable Notifications (0xFFE3 CCCD) ──>│
  │<─ Write Acknowledged ──────────────────│
  │                                          │
  │── Write 0xFFE2: {"cmd":"get_status"} ──>│
  │<─ Notify 0xFFE3: {"status":"ok",        │
  │     "data":{"state":"disconnected",...}} │
  │                                          │
  │── Write 0xFFE2: {"cmd":"scan"} ────────>│
  │                                          │  (blocks 3–5s for WiFi scan)
  │<─ Notify 0xFFE3: {"status":"ok",        │
  │     "data":{"networks":[...]}}          │
  │                                          │
  │── Write 0xFFE2: {"cmd":"add_network",   │
  │     "params":{"ssid":"Home",            │
  │               "password":"secret"}} ───>│
  │<─ Notify 0xFFE3: {"status":"ok",...}    │
  │                                          │
  │── Write 0xFFE2: {"cmd":"connect"} ─────>│
  │<─ Notify 0xFFE3: {"status":"ok",...}    │
  │                                          │  (async connect begins)
  │                                          │
  │── Write 0xFFE2: {"cmd":"get_status"} ──>│  (poll until connected)
  │<─ Notify: {"data":{"state":             │
  │     "connecting",...}}                   │
  │                                          │
  │── Write 0xFFE2: {"cmd":"get_status"} ──>│
  │<─ Notify: {"data":{"state":             │
  │     "connected","ip":"192.168.1.50"}}   │
  │                                          │
  │── Disconnect BLE ──────────────────────>│
  │                                          │  (advertising restarts)
```

### Notes on Polling

Connection is asynchronous — `connect` returns immediately. The client must poll `get_status` to determine when the device has connected and received an IP address. There is no push notification for state changes (the Status characteristic's notify capability is wired but not proactively triggered by state changes in the current implementation).

---

## BLE vs HTTP API: Feature Parity

The BLE GATT interface has near-full parity with the HTTP REST API. The table below shows the status:

| Category | HTTP | BLE | Notes |
|---|---|---|---|
| Get WiFi status | Full | Full | All fields returned |
| Scan networks | Full | Full | |
| List saved networks | Full | Full | |
| Add network | Full | Full | |
| Update network | Full | Full | |
| Delete network | Full | Full | |
| Connect/disconnect | Full | Full | |
| Get AP status | Full | Partial | BLE omits `clients` array (MAC/IP per connected client) |
| Get/set AP config | Full | **N/A** | Full AP config CRUD not exposed over BLE |
| Start/stop AP | Full | Full | BLE `start_ap` accepts optional `ssid`/`password` overrides |
| List all variables | Full | Full | |
| Get variable | Full | Full | |
| Set variable | Full | Full | |
| Delete variable | Full | Full | |
| Factory reset | Full | Full | |

### Remaining Gaps

**`get_ap_status`** — the BLE response omits the `clients` array present in the HTTP response. The BLE response does include `active`, `ssid`, `ip`, `channel`, and `sta_count`.

**AP config management** — `GET /api/wifi/ap/config` and `PUT /api/wifi/ap/config` have no BLE equivalent. The `start_ap` BLE command accepts temporary `ssid`/`password` overrides, but persistent AP configuration changes (channel, max connections, DHCP range, etc.) require HTTP or CLI.

---

## Deactivation & Cleanup

### When Deactivation Occurs

`wifi_cfg_ble_deinit()` is called during `wifi_cfg_deinit()`. The BLE interface runs for the entire lifetime of the WiFi config component — there is no way to stop BLE independently without deinitializing the entire component.

### Deinitialization Sequence

`wifi_cfg_ble_deinit()` resets shared state (connected flag, notify-enabled flag) then delegates to `wifi_cfg_ble_backend_deinit()`. The backend tears down the host stack and BT controller in the appropriate order for that stack:

- **Bluedroid**: unregisters the GATT app, disables and frees Bluedroid, disables and frees the BT controller
- **NimBLE**: stops the NimBLE host task, stops the port, frees the NimBLE host, disables and frees the BT controller

### What Gets Released

- GATT service and advertising (stopped)
- Host stack (disabled and freed)
- BT controller (disabled and freed)
- Internal state is reset

---

## Implications for Subsequent BLE Usage

If your application needs to use BLE for its own purposes after WiFi provisioning, there are several issues to be aware of. These apply to **both host stacks** unless noted otherwise.

### Issue 1: Classic BT Memory Is Permanently Released (Bluedroid only)

When using the Bluedroid backend, the library calls:
```c
esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);
```

This is **irreversible within a single boot cycle**. Classic Bluetooth cannot be used after this call — only BLE. If your application requires Classic BT (SPP, A2DP, etc.), you cannot use the WiFi Config BLE interface at all. A device restart is required to reclaim Classic BT memory. The NimBLE backend does not use Classic BT and does not release this memory.

### Issue 2: BLE Memory Is Not Released After Deinit

After deinit, the library does **not** call `esp_bt_controller_mem_release(ESP_BT_MODE_BLE)`. This means BLE controller memory (~60KB) remains allocated even when BLE is no longer in use. If you don't plan to use BLE after provisioning, you can reclaim it after `wifi_cfg_deinit()`:

```c
wifi_cfg_deinit(false);
esp_bt_controller_mem_release(ESP_BT_MODE_BLE);  // Reclaim ~60KB — BLE now unusable
```

This is irreversible within the current boot cycle.

### Recommended Patterns

**Pattern A: Application needs its own BLE after provisioning**

The BT controller and host stack are fully deinitialized by `wifi_cfg_ble_deinit()`, so you can reinitialize the entire BLE stack cleanly after `wifi_cfg_deinit()`. For Bluedroid, register your own callbacks (which will replace any stale WiFi Config pointers). For NimBLE, reinitialize `nimble_port` as normal.

**Pattern B: No BLE needed after provisioning**

Reclaim all BLE memory:

```c
wifi_cfg_deinit(false);
esp_bt_controller_mem_release(ESP_BT_MODE_BLE);  // ~60KB freed
```

**Pattern C: Don't use WiFi Config BLE at all**

If your application has its own BLE requirements and the provisioning interface is not needed, leave the custom BLE interface disabled at compile time:

```ini
# In sdkconfig
CONFIG_WIFI_CFG_ENABLE_CUSTOM_BLE=n
```

Use HTTP/Web UI or CLI for WiFi configuration instead. Your application retains full control of the BLE stack.

---

## Reference: Python CLI Client

A reference client implementation is provided at `tools/wifi_ble_cli/wifi_ble_cli.py`. It uses the [Bleak](https://github.com/hbldh/bleak) library and demonstrates the full command protocol. Usage:

```bash
pip install bleak click

# Discover devices
python wifi_ble_cli.py devices

# Get status
python wifi_ble_cli.py status

# Scan networks
python wifi_ble_cli.py scan

# Add and connect
python wifi_ble_cli.py add "MyNetwork" "password123"
python wifi_ble_cli.py connect

# Target a specific device by address or name prefix
python wifi_ble_cli.py -d AA:BB:CC:DD:EE:FF status
python wifi_ble_cli.py --name "ESP32-WiFi" status
```

The CLI uses the correct nested `"params"` format required by the firmware. All commands that require parameters pass them as a `"params"` object (e.g. `{"cmd": "add_network", "params": {"ssid": "...", "password": "..."}}`). New client implementations should follow this same structure.
