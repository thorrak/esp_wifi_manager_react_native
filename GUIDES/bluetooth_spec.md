# ESP-IDF Wi-Fi/Thread Provisioning over BLE — Protocol Specification

> **Purpose.** This document is a complete, source-derived specification of the BLE
> provisioning protocol that can be used to talk to ESP32 devices running Espressif's 
> `wifi_provisioning` (a.k.a. `network_provisioning`) component. It is written
> to be sufficient to **reimplement a client from scratch** (any language/platform) that
> can byte-match the wire format. Everything here was reverse-engineered from reviewing
> both the ESP-IDF component source and Espressif's first-party Android implementation 
> in order to establish ground truth.
>
> The `esp_wifi_config` library for ESP32 reimplements this protocol in the Python test
> script. The `esp-wifi-config-react-native` library relies on the 
> `@orbital-systems/react-native-esp-idf-provisioning` library to implement the spec. 

---

## 0. Table of Contents

1. [Architectural Overview](#1-architectural-overview)
2. [BLE Transport Layer](#2-ble-transport-layer)
3. [Endpoint Catalog](#3-endpoint-catalog)
4. [Message Framing & Protobuf Conventions](#4-message-framing--protobuf-conventions)
5. [Version & Capability Discovery (`proto-ver`)](#5-version--capability-discovery-proto-ver)
6. [Session Establishment & Security Schemes](#6-session-establishment--security-schemes)
   - [6.1 Security 0 — no encryption](#61-security-0--no-encryption)
   - [6.2 Security 1 — Curve25519 + AES-256-CTR](#62-security-1--curve25519--aes-256-ctr)
   - [6.3 Security 2 — SRP6a + AES-256-GCM](#63-security-2--srp6a--aes-256-gcm)
7. [Encrypted Application Messaging](#7-encrypted-application-messaging)
8. [Network Scan (`prov-scan`)](#8-network-scan-prov-scan)
9. [Network Configuration / Provisioning (`prov-config`)](#9-network-configuration--provisioning-prov-config)
10. [Network Control (`prov-ctrl`)](#10-network-control-prov-ctrl)
11. [Cloud Association (`cloud`)](#11-cloud-association-cloud)
12. [Custom Endpoints](#12-custom-endpoints)
13. [Complete Protobuf Reference](#13-complete-protobuf-reference)
14. [End-to-End Flows](#14-end-to-end-flows)
15. [Reimplementation Checklist & Gotchas](#15-reimplementation-checklist--gotchas)
16. [ESP-IDF Firmware Cross-Check (v5.2.7) — Discrepancies & Findings](#16-esp-idf-firmware-cross-check-v527--discrepancies--findings)
17. [Python Client Implementation Notes (v5.2.7-exact)](#17-python-client-implementation-notes-v527-exact)
18. [`esp_wifi_config` Library Specifics (hardware-verified, IDF 5.4.3)](#18-esp_wifi_config-library-specifics-hardware-verified-idf-543)

---

## 1. Architectural Overview

The protocol is layered. Understanding the layering is essential because **encryption is
applied at the application layer, not the BLE layer**, and the choice of security scheme is
negotiated before any encrypted data flows.

```
┌─────────────────────────────────────────────────────────────┐
│ Application logic (scan / config / apply / status / ctrl)     │  protobuf payloads
├─────────────────────────────────────────────────────────────┤
│ Session layer: encrypt() before send, decrypt() after recv    │  Sec0/Sec1/Sec2
├─────────────────────────────────────────────────────────────┤
│ Endpoint dispatch: named endpoint  →  GATT characteristic     │  "prov-config" → UUID
├─────────────────────────────────────────────────────────────┤
│ BLE GATT transport: write-then-read on a single characteristic │  request/response
└─────────────────────────────────────────────────────────────┘
```

Core concepts:

- **Endpoints** are *named logical channels* (e.g. `"prov-session"`, `"prov-config"`).
  Each endpoint is backed by one GATT characteristic. The mapping name→characteristic is
  **discovered at runtime** by reading the BLE *Characteristic User Description* descriptor
  (UUID `0x2901`) of each characteristic — its value is the endpoint name string.
- **Every transaction is request/response**: the client *writes* a payload to a
  characteristic, then *reads* the same characteristic to obtain the response. There are no
  notifications/indications.
- **Two endpoints are special / always plaintext**: `proto-ver` (capability discovery) and
  `prov-session` (the security handshake itself). Every *other* endpoint's payload is
  encrypted/decrypted by the negotiated security scheme.
- **Protobuf** (proto3) is the serialization for everything except the `proto-ver` request
  (a literal ASCII string `"ESP"`) and its response (a JSON object).

---

## 2. BLE Transport Layer

Source: `transport/BLETransport.java`, `device_scanner/BleScanner.java`,
`transport/Transport.java`.

### 2.1 Scanning & discovery

- Uses Android `BluetoothLeScanner` with `ScanSettings.SCAN_MODE_BALANCED`.
- Scan window/timeout in this library: **6000 ms** (`BleScanner.SCAN_TIME_OUT`). Not
  protocol-significant — a reimplementation may scan however it likes.
- Device selection in this library is by **advertised device-name prefix** (optional). The
  library does **not** itself parse a service UUID out of the advertisement; the **primary
  service UUID is supplied by the caller** (typically obtained from the device's
  `ScanResult` service-UUID list, or from a provisioning QR code). A reimplementer should
  filter scan results by the device's advertised 128-bit service UUID.

> **Important:** The provisioning **service UUID is device/firmware-specific and not
> hard-coded** in this library. ESP-IDF devices advertise a custom 128-bit service UUID
> (commonly derived from a base like `021a9004-...` / `0000ffXX-...` depending on firmware
> config). The client must learn it from the advertisement or QR code. The protocol logic
> below is independent of the specific service UUID value.

### 2.2 GATT connection & MTU

1. `connectGatt(context, autoConnect=false, callback, TRANSPORT_LE)` (API ≥ 23).
   `autoConnect` is **false** (direct connect).
2. On `STATE_CONNECTED` → immediately call `requestMtu(512)`.
3. On `onMtuChanged(...)` (regardless of negotiated value) → call `discoverServices()`.
4. Connection error handling: GATT status `GATT_FAILURE` or the infamous Android code
   `133` are treated as connection failures.

> A reimplementer should request a large MTU (the reference uses **512**) so that scan
> results, config payloads, and SRP6a 3072-bit keys (~384 bytes) fit in a single
> characteristic write/read without app-level fragmentation. **This protocol has no
> application-level fragmentation** — each request and each response must fit within one
> ATT operation (MTU − 3 bytes of ATT header). With MTU 512 the usable payload is ~509
> bytes. (Security2's SRP keys are the largest single payloads.)

### 2.3 Service & characteristic discovery → endpoint mapping

After `onServicesDiscovered`:

1. Get the primary service: `gatt.getService(serviceUuid)`.
2. Enumerate **all** characteristics of that service; record their UUIDs.
3. Set each characteristic's write type to `WRITE_TYPE_DEFAULT` (write **with** response).
4. For each characteristic, read its descriptors and find the one whose UUID contains
   `"2901"` (the **Characteristic User Description** descriptor, full UUID
   `00002901-0000-1000-8000-00805f9b34fb`). Issue `readDescriptor()` on it.
5. On `onDescriptorRead`, decode the descriptor value as **UTF-8** → this string is the
   **endpoint name**. Store the mapping `endpointName → characteristicUUID`.

So the endpoint→characteristic table is built entirely from `0x2901` descriptor reads. A
reimplementer must:
- read the `0x2901` descriptor of every characteristic in the provisioning service, and
- build a map from the UTF-8 descriptor value (e.g. `"prov-config"`) to the characteristic.

**Fallback characteristic.** If a named endpoint is found in the map but
`getCharacteristic(uuid)` returns null, the library falls back to the hard-coded UUID
`0000ff52-0000-1000-8000-00805f9b34fb`. This is a legacy default and should be treated as a
last-resort fallback only.

### 2.4 Request/response transaction (the heart of the transport)

A single transaction for endpoint `path` with payload `data`:

```
1. acquire a binary semaphore (serializes transactions — only ONE in flight at a time)
2. characteristic = map[path]   (fallback to 0000ff52 if null)
3. characteristic.setValue(data)
4. gatt.writeCharacteristic(characteristic)        // WRITE WITH RESPONSE
5. onCharacteristicWrite(status):
      if SUCCESS  -> gatt.readCharacteristic(characteristic)   // READ the response back
      else        -> fail, release semaphore
6. onCharacteristicRead(status):
      if SUCCESS  -> response bytes = characteristic.getValue();  deliver to caller
      else        -> fail
      release semaphore
```

Key properties for a reimplementer:

- **Write-then-read on the same characteristic.** The device places its response into the
  characteristic value; the client must perform an explicit GATT **read** after the write
  ACK to retrieve it. There are **no notifications** (CCCD `0x2902` is never written; the
  `onCharacteristicChanged` callback is unused).
- **Strictly serialized.** Only one outstanding transaction at any time (binary semaphore).
  Never pipeline writes.
- **Response callbacks** are dispatched off the GATT thread (a single-threaded executor) to
  avoid deadlocking the BLE stack.

### 2.5 Connection lifecycle

- `disconnect()` → `gatt.disconnect()` then `gatt.close()`.
- `refreshServices()` uses reflection to call the hidden `BluetoothGatt.refresh()` then
  re-discovers services (clears the Android GATT cache; useful when the device's attribute
  table changed between connections).
- No transport-level timeouts; higher layers impose them (e.g. Wi-Fi connect status
  polling, below).

---

## 3. Endpoint Catalog

Endpoint name strings (exact literals, from `ESPConstants.java:44-48`):

| Constant                 | Endpoint string  | Encrypted? | Purpose                                  | Protobuf root message     |
|--------------------------|------------------|------------|------------------------------------------|---------------------------|
| `HANDLER_PROTO_VER`      | `proto-ver`      | **No**     | Version & capability discovery           | *(none — `"ESP"` / JSON)* |
| `HANDLER_PROV_SESSION`   | `prov-session`   | **No**\*   | Security handshake                       | `SessionData`             |
| `HANDLER_PROV_SCAN`      | `prov-scan`      | Yes        | Wi-Fi / Thread network scan              | `NetworkScanPayload`      |
| `HANDLER_PROV_CONFIG`    | `prov-config`    | Yes        | Set/apply credentials, get status        | `NetworkConfigPayload`    |
| `HANDLER_PROV_CTRL`      | `prov-ctrl`      | Yes        | Reset / re-provision control             | `NetworkCtrlPayload`      |
| *(custom)*               | `cloud_user_assoc` etc. | Yes | Cloud association / vendor data          | `CloudConfigPayload` / vendor |
| *(custom)*               | any (`custom-data`, …)  | Yes | Arbitrary vendor endpoints               | vendor-defined            |

\* `prov-session` payloads carry the handshake itself; the handshake messages are not
encrypted by the session cipher (the cipher doesn't exist yet). After the session is
established, all subsequent endpoints' payloads pass through `encrypt()`/`decrypt()`.

> The endpoint **name strings are the contract**; the GATT characteristic UUIDs that back
> them are discovered dynamically (§2.3) and must not be assumed.

---

## 4. Message Framing & Protobuf Conventions

- Serialization is **proto3**. The `.proto` sources are in `provisioning/src/main/proto/`.
- All protos use `package espressif;` **except** `cloud.proto` which uses `package cloud;`.
- The wire is the raw `message.toByteArray()` (standard protobuf serialization). No length
  prefix, no envelope beyond the protobuf message itself — one protobuf message per BLE
  characteristic write, one per read.
- **Nesting pattern.** Each endpoint has a *root payload* message containing:
  - a `msg` field of an enum type that **discriminates the operation** (which command or
    response), and
  - a `oneof` holding exactly one of the command/response sub-messages.
  The receiver uses `msg` to know which `oneof` branch to read. (For some payloads the
  `oneof` tag alone is authoritative, but the reference client always sets `msg`
  consistently — **always set `msg`**.)
- proto3 semantics: scalar fields default to zero/empty and are omitted on the wire when
  default. Empty command messages (e.g. `CmdGetWifiStatus {}`) serialize to zero bytes
  inside their `oneof` slot; the `oneof` presence + `msg` enum convey intent.
- `bytes` fields carry raw binary (SSIDs, passphrases, keys, salts, proofs, BSSIDs). SSID
  and passphrase are the **raw UTF-8 bytes** of the string (`String.getBytes()`).

---

## 5. Version & Capability Discovery (`proto-ver`)

This is the **first** exchange after connect+discovery, and it is **always plaintext**.

**Request:** write the 3 ASCII bytes `"ESP"` (`0x45 0x53 0x50`) to the `proto-ver`
characteristic. (`ESPDevice.java:1647-1649`.)

**Response:** read back a **UTF-8 JSON** document. Structure:

```json
{
  "prov": {
    "ver": "v1.1",
    "sec_ver": 2,
    "sec_patch_ver": 1,
    "cap": ["no_pop"]
  },
  "<other-service>": { ... }
}
```

Fields the client reads (under `"prov"`):

| JSON key         | Type      | Meaning / handling                                                              |
|------------------|-----------|---------------------------------------------------------------------------------|
| `ver`            | string    | Firmware protocol version label (informational).                                |
| `sec_ver`        | int       | Security scheme: `0`→Sec0, `1`→Sec1, `2`(or anything else)→Sec2. **See below.** |
| `sec_patch_ver`  | int       | Only meaningful for Sec2. `1` selects the patched GCM nonce scheme (§6.3).       |
| `cap`            | string[]  | Capability flags. Recognized: **`no_pop`** (PoP not required → PoP set to `""`).|

**Security-version selection logic** (`ESPDevice.java:712-749`):

```
capabilities = prov.cap
if capabilities contains "no_pop":  proofOfPossession = ""      // PoP not needed

if prov has "sec_ver":
    switch (sec_ver):
        case 0: security = Security0
        case 1: security = Security1
        case 2:
        default: security = Security2
                 if prov has "sec_patch_ver": secPatchVersion = prov.sec_patch_ver
else:
    // legacy firmware without sec_ver
    if currently-configured security == Security2: downgrade to Security1
```

Notes:
- `"no_sec"` capability (seen on some firmwares) maps to Security0 conceptually; this client
  primarily keys off `sec_ver`. A robust reimplementation should honor both `sec_ver` and
  the presence of `no_sec`/`no_pop` capabilities.
- The library also exposes the raw capability list so application code can detect custom
  endpoints (e.g. cloud association) advertised by the firmware.

---

## 6. Session Establishment & Security Schemes

After `proto-ver`, the client establishes a session by driving a **handshake state machine**
on the `prov-session` endpoint. The driver (`Session.java:78-118`) is a simple recursion:

```
init(prevResponse):
    request = security.getNextRequestInSession(prevResponse)   // prevResponse=null on first call
    if request == null:
        session established  ✓
    else:
        write request to "prov-session"; read response
        init(response)            // recurse with the device's reply
```

Each security scheme implements `getNextRequestInSession()` as its own little state machine.
**All `prov-session` messages are the protobuf `SessionData` envelope** (`session.proto`):

```
SessionData {
    SecSchemeVersion sec_ver = 2;     // 0 / 1 / 2  — MUST match the scheme in use
    oneof proto {
        Sec0Payload sec0 = 10;
        Sec1Payload sec1 = 11;
        Sec2Payload sec2 = 12;
    }
}
enum SecSchemeVersion { SecScheme0 = 0; SecScheme1 = 1; SecScheme2 = 2; }
```

Every handshake message and every response sets `sec_ver` to the scheme being used; the
client **rejects** a response whose `sec_ver` doesn't match (raises "Security version
mismatch").

The default credentials before discovery: `proofOfPossession = ""`, `userName = ""`
(`ESPDevice.java:93-94`). The application typically sets the PoP (and for Sec2, the
username) before connecting.

---

### 6.1 Security 0 — no encryption

Source: `security/Security0.java`.

- One-round handshake.
- **Step 0 request** (`SessionData`, `sec_ver=SecScheme0`, `sec0` set):
  ```
  Sec0Payload { sc = S0SessionCmd {} }    // empty command; msg defaults to S0_Session_Command=0
  ```
- **Step 0 response**: a `SessionData` with `sec_ver=SecScheme0`; the client only validates
  the version. The embedded `Sec0Payload.sr = S0SessionResp { status }`.
- After this single round, `getNextRequestInSession()` returns null → session established.
- `encrypt(data)` and `decrypt(data)` are **identity functions** — all subsequent endpoint
  payloads are sent/received in cleartext protobuf.

---

### 6.2 Security 1 — Curve25519 + AES-256-CTR

Source: `security/Security1.java`, `utils/HexEncoder.java`. Crypto: Tink `X25519`,
JCE `AES/CTR/NoPadding`, `SHA-256`.

Two-round handshake. State machine: `REQUEST1 → RESPONSE1_REQUEST2 → RESPONSE2 → FINISHED`.

#### Step 0 — client public key

1. Generate an ephemeral **Curve25519 (X25519)** key pair:
   - `privateKey = X25519.generatePrivateKey()` (32 bytes, random clamp per X25519).
   - `publicKey  = X25519.publicFromPrivate(privateKey)` (32 bytes).
2. Send `SessionData(sec_ver=SecScheme1, sec1=Sec1Payload{ sc0 = SessionCmd0{ client_pubkey = publicKey } })`.
   - `msg` is left default (`Session_Command0 = 0`).

#### Step 0 response — device public key + random, derive session key

Device replies `Sec1Payload.sr0 = SessionResp0 { status, device_pubkey (32B), device_random (16B) }`.

Client computes:

1. `shared = X25519.computeSharedSecret(privateKey, device_pubkey)` → **32-byte** ECDH secret.
2. **Proof-of-Possession mixing** (only if a PoP is set; PoP is the UTF-8 bytes of the PoP
   string):
   ```
   popHash = SHA-256(PoP)                       // 32 bytes
   shared  = shared XOR popHash                 // byte-wise XOR, both 32 bytes
   ```
   (`HexEncoder.xor` cycles the shorter operand if lengths differ, but here both are 32 B.)
   If PoP is empty/absent, `shared` is used directly. *(Note: the reference dereferences the
   PoP byte array unconditionally; a reimplementation should treat "no PoP" as "skip the XOR
   step" — equivalent to PoP-derived hash not applied.)*
3. Initialize the cipher:
   ```
   key = shared                                 // 32 bytes → AES-256
   iv  = device_random                          // 16 bytes → CTR initial counter block
   cipher = AES/CTR/NoPadding, init(ENCRYPT_MODE, key, iv)
   ```
4. Compute the **client verification token**:
   ```
   client_verify = cipher.update(device_pubkey) // AES-CTR keystream applied to 32-byte device pubkey
   ```

#### Step 1 — exchange verification tokens

- Client sends
  `SessionData(sec_ver=SecScheme1, sec1=Sec1Payload{ msg=Session_Command1, sc1 = SessionCmd1{ client_verify_data = client_verify } })`.
- Device replies `Sec1Payload.sr1 = SessionResp1 { status, device_verify_data }`.
- Client verifies:
  ```
  decrypted = cipher.update(device_verify_data)   // continue the SAME CTR stream
  assert decrypted == client_pubkey               // else "Session establishment failed!"
  ```
  i.e., the device proves it derived the same session key by encrypting the *client's* public
  key, and the client checks it decrypts back to its own public key.

#### Cipher behavior for application data (critical)

```
encrypt(data) = cipher.update(data)
decrypt(data) = cipher.update(data)
```

- **The cipher is a single, stateful, continuous AES-256-CTR stream.** It is initialized
  **once** (Step 0) in `ENCRYPT_MODE` and **never re-initialized**. Both `encrypt` and
  `decrypt` call `Cipher.update()`, so the **CTR counter advances across every byte of every
  message** in both directions.
- Consequence: the keystream consumed by `client_verify` (32 bytes) and by every subsequent
  request/response is contiguous. **Ordering and exact byte counts matter** — a reimplementer
  must maintain one CTR counter that increments by `ceil(bytes/16)` blocks per `update`, in
  the exact sequence: `encrypt(device_pubkey)` (step 0) → then each application message in
  call order. AES-CTR is symmetric, so encrypt and decrypt are the same keystream XOR.
- CTR counter is big-endian 128-bit, seeded from the 16-byte `device_random` (standard JCE
  `AES/CTR` semantics).

---

### 6.3 Security 2 — SRP6a + AES-256-GCM

Source: `security/Security2.java`, `srp6a/*`. Crypto: SRP-6a (RFC 5054-style with Espressif
M1 variation), `SHA-512`, `AES/GCM/NoPadding`.

This scheme performs a **mutual password-authenticated key exchange (SRP-6a)** and derives an
AES-256-GCM session key. The "password" is the **Proof-of-Possession**; the SRP username is
the configured `userName`.

- Constructor: `Security2(userName, password=PoP [, secPatchVersion])`. Internally a
  `SRP6ClientSession` is created and `step1(username, password)` is called.

#### SRP6a parameters (`SRP6CryptoParams.getInstance(3072, "SHA-512")`)

| Param | Value |
|-------|-------|
| `N`   | RFC 5054 **3072-bit** safe prime (hex begins `FFFFFFFF…C90FDAA2…`; 384 bytes when encoded). |
| `g`   | generator **5**. |
| `H`   | **SHA-512** (64-byte digest). |
| `k`   | `H(PAD(N) ∥ PAD(g))` — multiplier parameter (RFC 5054). |
| Padding | left-pad to `ceil(N.bitLength/8)` = **384 bytes** for `PAD()`. |

#### Big-integer encoding (`srp6a/BigIntegerUtils.java`)

- **toBytes:** `BigInteger.toByteArray()` then strip a leading `0x00` sign byte if present →
  **unsigned big-endian, minimal length**.
- **fromBytes:** `new BigInteger(1, bytes)` → unsigned big-endian.
- Wire values (`client_pubkey A`, `device_pubkey B`, `device_salt`, `client_proof M1`,
  `device_proof M2`) are all this minimal unsigned big-endian encoding.

#### Step 0 — username + client public key A

1. `A = client.getClientPublicKey(params)` where `A = g^a mod N` (random ephemeral `a`).
2. Send
   `SessionData(sec_ver=SecScheme2, sec2=Sec2Payload{ sc0 = S2SessionCmd0{ client_username = userName(UTF-8), client_pubkey = toBytes(A) } })`.
   (`msg` defaults to `S2Session_Command0 = 0`.)

#### Step 0 response — salt + device public key B → compute proof M1

Device replies `Sec2Payload.sr0 = S2SessionResp0 { status, device_pubkey B, device_salt s }`.

Client (`SRP6ClientSession.step2_for_client_evidence`):

1. `salt = fromBytes(device_salt)`, `B = fromBytes(device_pubkey)`.
2. **Password key x** (`XRoutineWithUserIdentity`):
   ```
   x = SHA-512( salt ∥ SHA-512( username ∥ ":" ∥ password ) )
   ```
   (username and password UTF-8; `password` = PoP.)
3. **Premaster / session secret S** (RFC 5054 client side):
   ```
   u = H(PAD(A) ∥ PAD(B))
   k = H(PAD(N) ∥ PAD(g))
   S = (B − k·g^x)^(a + u·x) mod N
   ```
4. **Shared key K** = `SHA-512(toBytes(S))`  → 64 bytes (stored as BigInteger).
5. **Client evidence M1** — *Espressif variation* (`ClientSRP6Routines`), **not** the plain
   RFC 5054 M1:
   ```
   H_N   = SHA-512( toBytes(N) )                 // N padded to 384 bytes
   H_g   = SHA-512( PAD_to_384(toBytes(g)) )     // g=5 left-padded to 384 bytes
   c     = H_N XOR H_g                           // 64 bytes
   H_I   = SHA-512( username )                   // 64 bytes
   M1    = SHA-512( c ∥ H_I ∥ s ∥ A ∥ B ∥ K )
   ```
   where `s, A, B, K` are their big-integer byte encodings. `M1` is stored as `clientProof`.

#### Step 1 — send M1, verify device proof M2, extract GCM key/nonce

1. Send
   `SessionData(sec_ver=SecScheme2, sec2=Sec2Payload{ msg=S2Session_Command1, sc1 = S2SessionCmd1{ client_proof = toBytes(M1) } })`.
2. Device replies `Sec2Payload.sr1 = S2SessionResp1 { status, device_proof M2, device_nonce }`.
3. **Verify server evidence** `client.step3(fromBytes(M2))`:
   ```
   expected_M2 = H( A ∥ M1 ∥ K )     // standard RFC 5054 server-evidence form
   assert M2 == expected_M2           // else SRP6Exception "bad server credentials"
   ```
4. **Derive the AES key:**
   ```
   sharedKey = toBytes(K)             // 64 bytes (SHA-512 output)
   key       = sharedKey[0 .. 32)     // FIRST 32 bytes → AES-256 key
   ```
5. **Seed the GCM counter** from the device nonce:
   ```
   counter = big-endian uint32 of device_nonce[8..11]
   ```
   (Used only in patch-version 1; see below.)

#### AES-256-GCM application encryption

Cipher: `AES/GCM/NoPadding` (16-byte / 128-bit authentication tag appended by JCE
`doFinal`). **Re-initialized per message** (stateless across messages, unlike Sec1).

Two nonce modes, chosen by `sec_patch_ver` from `proto-ver`:

- **`sec_patch_ver != 1` (default / "v0"):** the IV is the **entire `device_nonce`** as
  received (typically 16 bytes), used **unchanged for every message** in both directions:
  ```
  encrypt(data): cipher.init(ENCRYPT, key, IV=device_nonce); return cipher.doFinal(data)
  decrypt(data): cipher.init(DECRYPT, key, IV=device_nonce); return cipher.doFinal(data)
  ```
- **`sec_patch_ver == 1` (patched):** a **12-byte** nonce is constructed per message:
  ```
  nonce[0..7]  = device_nonce[0..7]              // fixed prefix
  nonce[8..11] = big-endian uint32(counter)      // incrementing counter
  counter++    // post-increment AFTER building each nonce, on BOTH encrypt and decrypt
  ```
  The counter starts at `big-endian uint32(device_nonce[8..11])` and is **shared/incremented
  across both encrypt and decrypt calls**. So a reimplementer must use one counter, advance it
  once per GCM operation (whether send or receive), in call order.

> **GCM tag:** ciphertext = ENC ∥ 16-byte tag (JCE default). The device expects/produces the
> tag appended. There is **no additional authenticated data (AAD)** set.

---

## 7. Encrypted Application Messaging

Once the session is established, every endpoint other than `proto-ver`/`prov-session` is
accessed via (`Session.java:120-145`):

```
sendDataToDevice(path, plaintextProtobuf, listener):
    cipher_in  = security.encrypt(plaintextProtobuf)
    write cipher_in to endpoint `path`; read cipher_out
    plaintext_out = security.decrypt(cipher_out)
    listener.onSuccess(plaintext_out)
```

- For **Security0** this is a no-op (plaintext both ways).
- For **Security1** this advances the single shared CTR stream (order-sensitive).
- For **Security2** this runs a fresh GCM op (advancing the counter in patch-v1 mode).

The plaintext is always the endpoint's protobuf payload message (`NetworkScanPayload`,
`NetworkConfigPayload`, `NetworkCtrlPayload`, `CloudConfigPayload`, or vendor bytes).

---

## 8. Network Scan (`prov-scan`)

Payload root: `NetworkScanPayload` (`network_scan.proto`). Wi-Fi scan is a **3-phase**,
**paginated** operation. Source: `MessengeHelper.java`, `ESPDevice.java`.

### 8.1 Start scan

Request (`prepareWiFiScanMsg`):
```
NetworkScanPayload {
    msg = TypeCmdScanWifiStart            // 0
    cmd_scan_wifi_start = CmdScanWifiStart {
        blocking       = true
        passive        = false
        group_channels = 0
        period_ms      = 120
    }
}
```
Response: `RespScanWifiStart` (empty) with `status`.

### 8.2 Poll scan status

Request (`prepareGetWiFiScanStatusMsg`): `msg = TypeCmdScanWifiStatus (2)`, empty
`CmdScanWifiStatus`.
Response: `RespScanWifiStatus { scan_finished: bool, result_count: uint32 }`.
- The client reads `result_count` as the total number of APs to fetch.

### 8.3 Fetch results (paginated)

Request (`prepareGetWiFiScanListMsg(start, count)`): `msg = TypeCmdScanWifiResult (4)`,
`CmdScanWifiResult { start_index, count }`.

**Pagination rule (`ESPDevice`):** fetch in batches of **4**. If `result_count < 4`, fetch
`(0, result_count)` in one go; otherwise loop `start_index += 4`, requesting
`min(4, remaining)` each time, until all are retrieved.

Response: `RespScanWifiResult { repeated WiFiScanResult entries }`, each:
```
WiFiScanResult {
    bytes  ssid        // raw bytes; decode as UTF-8 for display
    uint32 channel
    int32  rssi        // dBm (signed)
    bytes  bssid       // 6-byte MAC
    WifiAuthMode auth  // see enum below
}
```

`WifiAuthMode` (`network_constants.proto`): `Open=0, WEP=1, WPA_PSK=2, WPA2_PSK=3,
WPA_WPA2_PSK=4, WPA2_ENTERPRISE=5, WPA3_PSK=6, WPA2_WPA3_PSK=7`.

### 8.4 Thread scan (analogous)

Same 3 phases with Thread message types (`TypeCmdScanThreadStart=6`, `…Status=8`,
`…Result=10`). `CmdScanThreadStart { blocking=true, channel_mask=0 }`. Results:
```
ThreadScanResult { uint32 pan_id; uint32 channel; int32 rssi; uint32 lqi;
                   bytes ext_addr; string network_name; bytes ext_pan_id }
```

---

## 9. Network Configuration / Provisioning (`prov-config`)

Payload root: `NetworkConfigPayload` (`network_config.proto`). Wi-Fi provisioning is
**set → apply → poll-status**.

### 9.1 Set credentials

Request (`prepareWiFiConfigMsg`):
```
NetworkConfigPayload {
    msg = TypeCmdSetWifiConfig            // 2
    cmd_set_wifi_config = CmdSetWifiConfig {
        ssid       = <ssid UTF-8 bytes>
        passphrase = <passphrase UTF-8 bytes>   // omitted if null/open network
        // bssid, channel optional (not set by this client by default)
    }
}
```
Response: `RespSetWifiConfig { status }`. `status == Success(0)` → proceed; else fail.

### 9.2 Apply config

Request (`prepareApplyWiFiConfigMsg`): `msg = TypeCmdApplyWifiConfig (4)`, empty
`CmdApplyWifiConfig`.
Response: `RespApplyWifiConfig { status }`.
- On success, the reference client **waits ~2000 ms** then begins polling status.

### 9.3 Poll connection status

Request (`prepareGetWiFiConfigStatusMsg`): `msg = TypeCmdGetWifiStatus (0)`, empty
`CmdGetWifiStatus`.
Response:
```
RespGetWifiStatus {
    Status            status
    WifiStationState  wifi_sta_state
    oneof state {
        WifiConnectFailedReason wifi_fail_reason   = 10;   // when failed
        WifiConnectedState      wifi_connected     = 11;   // when connected
        WifiAttemptFailed       wifi_attempt_failed = 12;  // transient: a retry attempt failed
    }
}
```

> **`wifi_attempt_failed` (oneof tag 12, firmware name `attempt_failed`).** Present in
> IDF ≥ 5.4 (`wifi_constants.proto`: `WifiAttemptFailed { uint32 attempts_remaining = 1 }`).
> This is **not** a terminal failure — the device emits it while `wifi_sta_state` is still
> `Connecting`, to report that one connection attempt failed and how many retries remain. A
> client should treat it as "keep polling"; only `ConnectionFailed (3)` is terminal. **Clients
> must tolerate this third oneof branch** — older clients that only handle tags 10/11 will see
> an unknown field and should ignore it (proto3 makes this safe).

`WifiStationState`: `Connected=0, Connecting=1, Disconnected=2, ConnectionFailed=3`.
`WifiConnectFailedReason`: `AuthError=0, WifiNetworkNotFound=1`.
`WifiConnectedState { string ip4_addr; WifiAuthMode auth_mode; bytes ssid; bytes bssid; int32 channel }`.

**Polling state machine (`ESPDevice.pollForWifiConnectionStatus`):**
```
Connected     -> provisioning success;  (clear session, disconnect)
Connecting    -> wait ~5000 ms, poll again
Disconnected  -> fail: DEVICE_DISCONNECTED
ConnectionFailed / else:
    AuthError            -> fail: AUTH_FAILED
    WifiNetworkNotFound  -> fail: NETWORK_NOT_FOUND
    default              -> fail: UNKNOWN
```
Failure reasons surface as `ProvisionFailureReason { AUTH_FAILED, NETWORK_NOT_FOUND,
DEVICE_DISCONNECTED, UNKNOWN }`.

### 9.4 Thread configuration (analogous)

`CmdSetThreadConfig { dataset }` where `dataset` is the **Thread Active Operational Dataset**
provided as a **hex string**, converted to raw bytes (two hex chars → one byte). Types:
`TypeCmdSetThreadConfig=8`, `TypeCmdApplyThreadConfig=10`, `TypeCmdGetThreadStatus=6`.
Status: `ThreadNetworkState { Attached=0, Attaching=1, Dettached=2, AttachingFailed=3 }`,
`ThreadAttachFailedReason { DatasetInvalid=0, ThreadNetworkNotFound=1 }`,
`ThreadAttachState { uint32 pan_id; bytes ext_pan_id; uint32 channel; string name }`. Poll
loop mirrors Wi-Fi (Attaching → wait 5000 ms → retry).

---

## 10. Network Control (`prov-ctrl`)

Payload root: `NetworkCtrlPayload` (`network_ctrl.proto`). Used to reset or restart
provisioning on an already-provisioned device.

Request (`prepareResetWifiMsg`): `msg = TypeCmdCtrlWifiReset (1)`, empty `CmdCtrlWifiReset`.
Response: `NetworkCtrlPayload { status }`.

`NetworkCtrlMsgType`: `TypeCtrlReserved=0, TypeCmdCtrlWifiReset=1, TypeRespCtrlWifiReset=2,
TypeCmdCtrlWifiReprov=3, TypeRespCtrlWifiReprov=4, TypeCmdCtrlThreadReset=5,
TypeRespCtrlThreadReset=6, TypeCmdCtrlThreadReprov=7, TypeRespCtrlThreadReprov=8`.

- **Reset** clears stored credentials. **Reprov** restarts the provisioning state.

---

## 11. Cloud Association (`cloud`)

Payload root: `CloudConfigPayload` (`cloud.proto`, `package cloud;`). Used for cloud (e.g.
ESP RainMaker) user-device association via a custom endpoint such as `cloud_user_assoc`.

```
CloudConfigPayload {
    msg = TypeCmdGetSetDetails (0)
    oneof payload {
        CmdGetSetDetails  cmd_get_set_details  = 10;   // { string UserID; string SecretKey }
        RespGetSetDetails resp_get_set_details = 11;   // { CloudConfigStatus Status; string DeviceSecret }
    }
}
enum CloudConfigStatus { Success=0; InvalidParam=1; InvalidState=2 }
```

This is sent over a vendor-named endpoint (discovered via `0x2901`) and passes through the
session cipher like any other application message.

---

## 12. Custom Endpoints

`ESPDevice.sendDataToCustomEndPoint(path, data, listener)` sends **arbitrary bytes** to any
endpoint discovered in the `0x2901` map. If no session exists yet, it first establishes one
(`proto-ver` → handshake), then `session.sendDataToDevice(path, data, listener)` — i.e. the
data is encrypted/decrypted by the active scheme. The caller owns serialization. This is how
vendor protobufs (RainMaker, custom config) are exchanged.

> ⚠️ **Zero-length write gotcha (verified on hardware).** Never send an **empty** payload to a
> custom (or any) endpoint. For Security 1 the keystream of 0 bytes is 0 bytes, and for
> Security 0 the payload is empty as-is — so an empty request becomes a **zero-length GATT
> write**, which the ESP32 protocomm BLE transport does **not** dispatch to a handler. The
> device produces **no response** and the follow-up read returns an empty value (the client
> sees `b""`). If an endpoint takes no input, still send at least one byte — e.g. the ASCII
> JSON `{}` — so the encrypted payload is non-empty. (Security 2/GCM always appends a 16-byte
> tag, so its requests are never zero-length and this does not bite Sec2.)

---

## 13. Complete Protobuf Reference

Field numbers and enum integers are authoritative for byte-matching. (`provisioning/src/main/proto/`.)

### 13.1 `constants.proto`
```proto
enum Status {
  Success = 0; InvalidSecScheme = 1; InvalidProto = 2; TooManySessions = 3;
  InvalidArgument = 4; InternalError = 5; CryptoError = 6; InvalidSession = 7;
}
```

### 13.2 `session.proto`
```proto
enum SecSchemeVersion { SecScheme0 = 0; SecScheme1 = 1; SecScheme2 = 2; }
message SessionData {
  SecSchemeVersion sec_ver = 2;
  oneof proto { Sec0Payload sec0 = 10; Sec1Payload sec1 = 11; Sec2Payload sec2 = 12; }
}
```

### 13.3 `sec0.proto`
```proto
enum Sec0MsgType { S0_Session_Command = 0; S0_Session_Response = 1; }
message S0SessionCmd  {}
message S0SessionResp { Status status = 1; }
message Sec0Payload {
  Sec0MsgType msg = 1;
  oneof payload { S0SessionCmd sc = 20; S0SessionResp sr = 21; }
}
```

### 13.4 `sec1.proto`
```proto
enum Sec1MsgType { Session_Command0=0; Session_Response0=1; Session_Command1=2; Session_Response1=3; }
message SessionCmd0  { bytes client_pubkey = 1; }
message SessionResp0 { Status status = 1; bytes device_pubkey = 2; bytes device_random = 3; }
message SessionCmd1  { bytes client_verify_data = 2; }     // NOTE: field number 2 (no field 1)
message SessionResp1 { Status status = 1; bytes device_verify_data = 3; }  // NOTE: field 3
message Sec1Payload {
  Sec1MsgType msg = 1;
  oneof payload { SessionCmd0 sc0=20; SessionResp0 sr0=21; SessionCmd1 sc1=22; SessionResp1 sr1=23; }
}
```

### 13.5 `sec2.proto`
```proto
enum Sec2MsgType { S2Session_Command0=0; S2Session_Response0=1; S2Session_Command1=2; S2Session_Response1=3; }
message S2SessionCmd0  { bytes client_username = 1; bytes client_pubkey = 2; }
message S2SessionResp0 { Status status = 1; bytes device_pubkey = 2; bytes device_salt = 3; }
message S2SessionCmd1  { bytes client_proof = 1; }
message S2SessionResp1 { Status status = 1; bytes device_proof = 2; bytes device_nonce = 3; }
message Sec2Payload {
  Sec2MsgType msg = 1;
  oneof payload { S2SessionCmd0 sc0=20; S2SessionResp0 sr0=21; S2SessionCmd1 sc1=22; S2SessionResp1 sr1=23; }
}
```

### 13.6 `network_constants.proto`
```proto
enum WifiStationState { Connected=0; Connecting=1; Disconnected=2; ConnectionFailed=3; }
enum WifiConnectFailedReason { AuthError=0; WifiNetworkNotFound=1; }
enum WifiAuthMode { Open=0; WEP=1; WPA_PSK=2; WPA2_PSK=3; WPA_WPA2_PSK=4; WPA2_ENTERPRISE=5; WPA3_PSK=6; WPA2_WPA3_PSK=7; }
enum ThreadNetworkState { Attached=0; Attaching=1; Dettached=2; AttachingFailed=3; }
enum ThreadAttachFailedReason { DatasetInvalid=0; ThreadNetworkNotFound=1; }
message WifiConnectedState { string ip4_addr=1; WifiAuthMode auth_mode=2; bytes ssid=3; bytes bssid=4; int32 channel=5; }
message WifiAttemptFailed  { uint32 attempts_remaining=1; }   // IDF >=5.4; emitted while Connecting
message ThreadAttachState  { uint32 pan_id=1; bytes ext_pan_id=2; uint32 channel=3; string name=4; }
```

### 13.7 `network_scan.proto`
```proto
enum NetworkScanMsgType {
  TypeCmdScanWifiStart=0;  TypeRespScanWifiStart=1;  TypeCmdScanWifiStatus=2; TypeRespScanWifiStatus=3;
  TypeCmdScanWifiResult=4; TypeRespScanWifiResult=5; TypeCmdScanThreadStart=6; TypeRespScanThreadStart=7;
  TypeCmdScanThreadStatus=8; TypeRespScanThreadStatus=9; TypeCmdScanThreadResult=10; TypeRespScanThreadResult=11;
}
message CmdScanWifiStart  { bool blocking=1; bool passive=2; uint32 group_channels=3; uint32 period_ms=4; }
message CmdScanThreadStart{ bool blocking=1; uint32 channel_mask=2; }
message RespScanWifiStart  {}   message RespScanThreadStart {}
message CmdScanWifiStatus  {}   message CmdScanThreadStatus {}
message RespScanWifiStatus { bool scan_finished=1; uint32 result_count=2; }
message RespScanThreadStatus { bool scan_finished=1; uint32 result_count=2; }
message CmdScanWifiResult  { uint32 start_index=1; uint32 count=2; }
message CmdScanThreadResult{ uint32 start_index=1; uint32 count=2; }
message WiFiScanResult   { bytes ssid=1; uint32 channel=2; int32 rssi=3; bytes bssid=4; WifiAuthMode auth=5; }
message ThreadScanResult { uint32 pan_id=1; uint32 channel=2; int32 rssi=3; uint32 lqi=4; bytes ext_addr=5; string network_name=6; bytes ext_pan_id=7; }
message RespScanWifiResult   { repeated WiFiScanResult entries=1; }
message RespScanThreadResult { repeated ThreadScanResult entries=1; }
message NetworkScanPayload {
  NetworkScanMsgType msg=1; Status status=2;
  oneof payload {
    CmdScanWifiStart cmd_scan_wifi_start=10; RespScanWifiStart resp_scan_wifi_start=11;
    CmdScanWifiStatus cmd_scan_wifi_status=12; RespScanWifiStatus resp_scan_wifi_status=13;
    CmdScanWifiResult cmd_scan_wifi_result=14; RespScanWifiResult resp_scan_wifi_result=15;
    CmdScanThreadStart cmd_scan_thread_start=16; RespScanThreadStart resp_scan_thread_start=17;
    CmdScanThreadStatus cmd_scan_thread_status=18; RespScanThreadStatus resp_scan_thread_status=19;
    CmdScanThreadResult cmd_scan_thread_result=20; RespScanThreadResult resp_scan_thread_result=21;
  }
}
```

### 13.8 `network_config.proto`
```proto
enum NetworkConfigMsgType {
  TypeCmdGetWifiStatus=0; TypeRespGetWifiStatus=1; TypeCmdSetWifiConfig=2; TypeRespSetWifiConfig=3;
  TypeCmdApplyWifiConfig=4; TypeRespApplyWifiConfig=5; TypeCmdGetThreadStatus=6; TypeRespGetThreadStatus=7;
  TypeCmdSetThreadConfig=8; TypeRespSetThreadConfig=9; TypeCmdApplyThreadConfig=10; TypeRespApplyThreadConfig=11;
}
message CmdGetWifiStatus {}  message CmdGetThreadStatus {}
message RespGetWifiStatus {
  Status status=1; WifiStationState wifi_sta_state=2;
  oneof state { WifiConnectFailedReason wifi_fail_reason=10; WifiConnectedState wifi_connected=11;
                WifiAttemptFailed wifi_attempt_failed=12; }   // tag 12; firmware name: attempt_failed
}
message WifiAttemptFailed { uint32 attempts_remaining=1; }    // IDF >=5.4 (wifi_constants.proto)
message RespGetThreadStatus {
  Status status=1; ThreadNetworkState thread_state=2;
  oneof state { ThreadAttachFailedReason thread_fail_reason=10; ThreadAttachState thread_attached=11; }
}
message CmdSetWifiConfig   { bytes ssid=1; bytes passphrase=2; bytes bssid=3; int32 channel=4; }
message CmdSetThreadConfig { bytes dataset=1; }
message RespSetWifiConfig  { Status status=1; }   message RespSetThreadConfig { Status status=1; }
message CmdApplyWifiConfig {}  message CmdApplyThreadConfig {}
message RespApplyWifiConfig { Status status=1; } message RespApplyThreadConfig { Status status=1; }
message NetworkConfigPayload {
  NetworkConfigMsgType msg=1;
  oneof payload {
    CmdGetWifiStatus cmd_get_wifi_status=10; RespGetWifiStatus resp_get_wifi_status=11;
    CmdSetWifiConfig cmd_set_wifi_config=12; RespSetWifiConfig resp_set_wifi_config=13;
    CmdApplyWifiConfig cmd_apply_wifi_config=14; RespApplyWifiConfig resp_apply_wifi_config=15;
    CmdGetThreadStatus cmd_get_thread_status=16; RespGetThreadStatus resp_get_thread_status=17;
    CmdSetThreadConfig cmd_set_thread_config=18; RespSetThreadConfig resp_set_thread_config=19;
    CmdApplyThreadConfig cmd_apply_thread_config=20; RespApplyThreadConfig resp_apply_thread_config=21;
  }
}
```

### 13.9 `network_ctrl.proto`
```proto
enum NetworkCtrlMsgType {
  TypeCtrlReserved=0; TypeCmdCtrlWifiReset=1; TypeRespCtrlWifiReset=2; TypeCmdCtrlWifiReprov=3;
  TypeRespCtrlWifiReprov=4; TypeCmdCtrlThreadReset=5; TypeRespCtrlThreadReset=6;
  TypeCmdCtrlThreadReprov=7; TypeRespCtrlThreadReprov=8;
}
message CmdCtrlWifiReset {}  message RespCtrlWifiReset {}
message CmdCtrlWifiReprov {} message RespCtrlWifiReprov {}
message CmdCtrlThreadReset {} message RespCtrlThreadReset {}
message CmdCtrlThreadReprov {} message RespCtrlThreadReprov {}
message NetworkCtrlPayload {
  NetworkCtrlMsgType msg=1; Status status=2;
  oneof payload {
    CmdCtrlWifiReset cmd_ctrl_wifi_reset=11; RespCtrlWifiReset resp_ctrl_wifi_reset=12;
    CmdCtrlWifiReprov cmd_ctrl_wifi_reprov=13; RespCtrlWifiReprov resp_ctrl_wifi_reprov=14;
    CmdCtrlThreadReset cmd_ctrl_thread_reset=15; RespCtrlThreadReset resp_ctrl_thread_reset=16;
    CmdCtrlThreadReprov cmd_ctrl_thread_reprov=17; RespCtrlThreadReprov resp_ctrl_thread_reprov=18;
  }
}
```

### 13.10 `cloud.proto`  *(`package cloud;`)*
```proto
enum CloudConfigStatus { Success=0; InvalidParam=1; InvalidState=2; }
enum CloudConfigMsgType { TypeCmdGetSetDetails=0; TypeRespGetSetDetails=1; }
message CmdGetSetDetails  { string UserID=1; string SecretKey=2; }
message RespGetSetDetails { CloudConfigStatus Status=1; string DeviceSecret=2; }
message CloudConfigPayload {
  CloudConfigMsgType msg=1;
  oneof payload { CmdGetSetDetails cmd_get_set_details=10; RespGetSetDetails resp_get_set_details=11; }
}
```

---

## 14. End-to-End Flows

### 14.1 Connect → session (all schemes)

```
BLE scan (filter by device service UUID / name)
  └─> connectGatt(autoConnect=false, TRANSPORT_LE)
        └─> requestMtu(512)
              └─> discoverServices()
                    └─> for each characteristic: read 0x2901 descriptor → build endpoint map
                          └─> WRITE "ESP" to proto-ver; READ JSON
                                └─> parse prov.{ver, sec_ver, sec_patch_ver, cap}
                                      └─> pick Security0/1/2 (+ patch); set PoP="" if cap has no_pop
                                            └─> handshake loop on prov-session (SessionData)
                                                  └─> session established
```

### 14.2 Wi-Fi scan

```
prov-scan: CmdScanWifiStart{blocking,!passive,period_ms=120}        -> RespScanWifiStart
prov-scan: CmdScanWifiStatus                                        -> RespScanWifiStatus{finished,count}
loop (batches of 4):
  prov-scan: CmdScanWifiResult{start_index, count<=4}               -> RespScanWifiResult{entries[]}
```

### 14.3 Wi-Fi provision

```
prov-config: CmdSetWifiConfig{ssid, passphrase}    -> RespSetWifiConfig{status}
prov-config: CmdApplyWifiConfig                     -> RespApplyWifiConfig{status}
wait ~2000 ms
loop:
  prov-config: CmdGetWifiStatus -> RespGetWifiStatus{wifi_sta_state, ...}
     Connecting   -> wait ~5000 ms, repeat
     Connected    -> SUCCESS (disconnect)
     Disconnected -> FAIL: DEVICE_DISCONNECTED
     Failed       -> FAIL: AuthError→AUTH_FAILED / NotFound→NETWORK_NOT_FOUND / else UNKNOWN
```

### 14.4 Handshake message sequences (per scheme)

```
Sec0: C→[SessionData sec0{sc=S0SessionCmd}]  ;  D→[SessionData sec0{sr}]   (done)

Sec1: C→[sec1{sc0: client_pubkey}]           ;  D→[sec1{sr0: device_pubkey, device_random}]
      C→[sec1{msg=Cmd1, sc1: client_verify}] ;  D→[sec1{sr1: device_verify}]  (verify==client_pubkey)

Sec2: C→[sec2{sc0: username, A}]             ;  D→[sec2{sr0: B, salt}]
      C→[sec2{msg=Cmd1, sc1: M1}]            ;  D→[sec2{sr1: M2, device_nonce}] (verify M2)
```

---

## 15. Reimplementation Checklist & Gotchas

A client that byte-matches this protocol must get all of the following right:

1. **No notifications.** Every transaction is *write-with-response* followed by an explicit
   *read* of the same characteristic. Serialize transactions (one at a time).
2. **Endpoints are discovered, not assumed.** Read the `0x2901` (User Description) descriptor
   of every characteristic in the provisioning service to map names → characteristics. The
   provisioning service UUID is firmware-specific (obtain from advertisement/QR).
3. **`proto-ver` is plaintext.** Request body is exactly the 3 bytes `"ESP"`. Response is
   JSON; read `prov.sec_ver`, `prov.sec_patch_ver`, `prov.cap`.
4. **Security selection:** `sec_ver` 0/1/2 → Sec0/Sec1/Sec2 (any other value → Sec2). Missing
   `sec_ver` ⇒ legacy: downgrade an intended Sec2 to Sec1. Capability `no_pop` ⇒ PoP = "".
5. **`SessionData.sec_ver` must match** the scheme on every handshake message; mismatched
   responses are a hard error.
6. **Sec1 single CTR stream.** Initialize `AES-256-CTR` once (key = X25519 shared secret,
   optionally XOR `SHA-256(PoP)`; IV = 16-byte `device_random`). Never re-init. Both encrypt
   and decrypt advance the *same* counter. First keystream use is `encrypt(device_pubkey)` to
   form `client_verify`; the device's `device_verify_data` decrypts back to the client's own
   public key. All app messages continue this one stream **in call order**.
7. **Sec1 PoP mixing** is `shared XOR SHA-256(PoP)` (32-byte XOR) — only when a PoP is set.
8. **Sec2 SRP6a specifics:** 3072-bit RFC 5054 prime, `g=5`, **SHA-512**. `x = H(salt ∥
   H(user ∥ ":" ∥ PoP))`. **Client evidence M1 uses Espressif's variant**:
   `M1 = H( (H(N) XOR H(g)) ∥ H(user) ∥ salt ∥ A ∥ B ∥ K )` with `N`/`g` padded to 384 bytes.
   Server evidence verify is standard `M2 = H(A ∥ M1 ∥ K)`.
9. **Sec2 key/nonce:** AES key = **first 32 bytes** of `K = SHA-512(S)`. GCM tag = 16 bytes
   appended, no AAD. Nonce depends on `sec_patch_ver`:
   - `!= 1`: IV = the full `device_nonce` (16 B), reused for **every** message.
   - `== 1`: 12-byte nonce = `device_nonce[0..7] ∥ big-endian uint32(counter)`, counter
     seeded from `device_nonce[8..11]` and **post-incremented on every encrypt *and* decrypt**.
10. **Big-integer encoding** for all Sec2 wire integers: unsigned, big-endian, minimal length
    (strip leading `0x00`).
11. **Field-number quirks:** `SessionCmd1.client_verify_data` is field **2** (no field 1);
    `SessionResp1.device_verify_data` is field **3**. Don't renumber them.
12. **SSID/passphrase/dataset:** SSID & passphrase are raw UTF-8 string bytes. Thread
    `dataset` is a hex string decoded to raw bytes (2 hex chars → 1 byte).
13. **Scan pagination** in batches of 4; **status polling** waits ~2 s after apply, then ~5 s
    between polls while `Connecting`.
14. **MTU:** request ~512; there is no app-layer fragmentation, so every request/response must
    fit in one ATT payload. SRP6a Sec2 (≈384-byte keys) is the sizing constraint.
15. **`cloud.proto` is in package `cloud`** (all others `espressif`) — matters if you generate
    code with package-qualified names.

---

## 16. ESP-IDF Firmware Cross-Check (v5.2.7) — Discrepancies & Findings

> **Scope of this section.** Everything above was derived from the **Android client**
> source. This section compares that client against the **ESP-IDF firmware it must talk
> to**, pinned at tag **`v5.2.7`** (the `wifi_provisioning` + `protocomm` components). It
> was produced by reading the firmware source directly; all `file:line` references below are
> into the ESP-IDF tree (`components/wifi_provisioning/...` and `components/protocomm/...`),
> **not** the Android repo. Read this section as the authoritative interop reconciliation.
>
> **Bottom line:** For a v5.2.7 device, the client's **Wi-Fi** provisioning flow is
> **wire-compatible** — every protobuf field number, enum integer, oneof tag, the BLE
> transport, and the Sec0/Sec1/Sec2 crypto all match. The client is **not** broadly
> "implemented incorrectly." But there are **three real hazards** (one latent crypto bug, one
> component-targeting mismatch, several behavioral edge cases) detailed below. Fix #16.1 and
> #16.2; the rest are caveats to encode defensively.

### 16.1 ⚠️ CRITICAL — Security 2 GCM nonce: the "v0 / 16-byte reused nonce" mode is dead and incompatible

The spec in §6.3 documents **two** Sec2 nonce modes selected by `sec_patch_ver`:
`!= 1` ⇒ full 16-byte `device_nonce` reused unchanged; `== 1` ⇒ 12-byte nonce + counter.
**The v5.2.7 firmware implements only the second one, unconditionally**, and it advertises
`sec_patch_ver = 1`:

- `AES_GCM_IV_SIZE` is **12** (`security2.c:38`); the IV is a struct
  `{ uint8_t session_id[8]; uint32_t counter; }` (`security2.c:46`). There is **no runtime
  branch on patch version** anywhere — the 12-byte counter nonce is the *only* code path.
- The `device_nonce` the firmware sends to the client is **12 bytes**
  (`device_nonce.len = AES_GCM_IV_SIZE`, `security2.c:310`), i.e. `session_id[8] ‖ BE32(1)`.
- The GCM counter is **seeded to 1** (`iv->counter = htobe32(0x1)`, `security2.c:277`) and
  post-incremented on **every** encrypt and decrypt (`security2.c:505`, `:552`).
- Firmware advertises `patch_ver = 1` (`security2.c:620`), surfaced into `proto-ver` JSON as
  `prov.sec_patch_ver` (`manager.c:264-267` via `protocomm_get_sec_version()`).

**Implications for the client:**

1. The client's `sec_patch_ver != 1` branch (full 16-byte reused nonce) will **never**
   interoperate with any shipping firmware. It is dead, and dangerous: if `proto-ver`
   parsing ever fails to surface `sec_patch_ver` (and it defaults to `0`), the client picks
   the 16-byte mode → the *first* GCM message may coincidentally pass (the 12-byte
   `device_nonce` already embeds `counter=1`), but **every subsequent message fails the GCM
   auth tag** because the firmware advances its counter while the client reuses the IV.
   → **Recommendation:** treat patched/12-byte+counter as the *only* supported Sec2 mode;
   remove or hard-gate the 16-byte path. Do **not** let a missing `sec_patch_ver` silently
   select it — default to `1` or refuse Sec2.
2. The "counter seeded from `device_nonce[8..11]`" rule (§6.3, §15-9) is **correct but is
   always 1** in practice, because the firmware transmits a 12-byte nonce whose last 4 bytes
   are `BE32(1)`. The client's patch-v1 logic therefore lines up exactly — keep it.
3. Confirm the client really requests a **12-byte** `device_nonce`-derived nonce; if any code
   assumes a 16-byte `device_nonce`, it will read 4 bytes past the wire value.

Everything else in Sec2 **matches** (verified against `esp_srp.c`):
3072-bit RFC 5054 prime + `g=5` + SHA-512 (`esp_srp.c:70-97`); `x = SHA512(salt ‖
SHA512(user ‖ ":" ‖ PoP))` (`:184-198`); `K = SHA512(toBytes(S))`, 64 B (`:573-575`);
the **Espressif M1 variant** `M1 = SHA512((SHA512(N) XOR SHA512(g)) ‖ SHA512(user) ‖ s ‖ A ‖
B ‖ K)` with `N`/`g` left-padded to 384 B (`:624-653`); standard `M2 = SHA512(A ‖ M1 ‖ K)`
(`:665-670`); AES key = first 32 B of `K`; 16-byte tag appended; **no AAD** (`security2.c:495`).

### 16.2 ⚠️ MAJOR — The client targets `network_provisioning`, not v5.2.7's `wifi_provisioning`

The client is built against `network_config/network_scan/network_ctrl/network_constants.proto`
with `Network*Payload` root messages **and Thread support**. That naming + Thread belongs to
the **newer, out-of-tree `network_provisioning`** managed component. **v5.2.7 ships
`wifi_provisioning`**, whose protos are `wifi_config/wifi_scan/wifi_ctrl/wifi_constants.proto`
with `WiFi*Payload` roots and **no Thread**.

- **Message/enum *names* differ, but names are not on the wire.** Every Wi-Fi-subset **field
  number, oneof tag, and enum integer is identical** between the two — so the rename is
  harmless and Wi-Fi provisioning interoperates byte-for-byte. (Verified field-by-field
  against `wifi_config.proto`, `wifi_scan.proto`, `wifi_ctrl.proto`, `wifi_constants.proto`.)
- **Thread is entirely absent in v5.2.7.** No Thread message types, no `dataset` field, no
  Thread enums (proto/src/include all clean). A client that issues any **Thread** operation
  (`NetworkConfig` msg types 6-8, `NetworkScan` 6-11, `NetworkCtrl` 5+, or their oneof tags
  16-21 / 15-18) hits **no handler**: `lookup_cmd_handler` fails → the dispatcher returns
  `ESP_FAIL` → **no response packet is produced** (the BLE read returns nothing/err). The
  client must **not** offer Thread for a v5.2.7 device; gate Thread on a firmware that
  actually advertises it.
- One **cosmetic** enum-name diff in the Wi-Fi set: firmware names value `1` of the connect-
  fail reason **`NetworkNotFound`** (`wifi_constants.proto:12`), the client calls it
  `WifiNetworkNotFound`. Integer `1` is identical — **harmless**.

### 16.3 `proto-ver` / capability discovery — matches, with firmware extras

`proto-ver` is registered (`manager.c:356`, BLE char UUID `0xFF53` at `manager.c:1373`) and
the JSON shape matches §5: top key **`prov`** with `ver` (`"v1.1"`, `manager.c:28/258`),
`sec_ver` (int, `:266`), `sec_patch_ver` (int, `:267`), `cap` (array, `:270`). Differences to
note:

- **The request payload is ignored.** The firmware handler never inspects the bytes
  (`protocomm.c:366-388`); sending `"ESP"` works, but so would anything. Harmless to the
  client, but don't rely on the device validating it.
- **Firmware always appends a `"wifi_scan"` capability** (`manager.c:280`) that the spec's
  capability table doesn't list. The client should tolerate unknown capability strings.
- **`cap` carries `no_sec` *or* `no_pop`, never both** (mutually exclusive, `manager.c:274-276`):
  `no_sec` when the configured scheme is Security0 (`manager.c:1576`); `no_pop` for Sec1/Sec2
  when the PoP is NULL (`manager.c:1594`). The client's `no_pop ⇒ PoP=""` logic is consistent;
  its `no_sec` handling should map to Security0.
- The firmware **asserts** `sec_ver == configured scheme` (`manager.c:265`), so the advertised
  `sec_ver` is trustworthy. v5.2.7 with Security2 advertises `sec_ver=2, sec_patch_ver=1`.

### 16.4 BLE transport — matches the write-then-read / no-notify / single-ATT model

All of §2's transport claims hold against `protocomm_ble.c` (Bluedroid) and
`protocomm_nimble.c` (NimBLE):

- **Endpoint name lives in the `0x2901` (Characteristic User Description) descriptor**, value =
  endpoint name UTF-8 (Bluedroid `protocomm_ble.c:544-551`; NimBLE `protocomm_nimble.c:707-732`,
  read at `gatt_svr_dsc_access:324-327`). The GATT DB has exactly 3 attributes per endpoint
  (decl, value, user-desc) — **no CCCD**.
- **Responses are returned by read-back of the same characteristic value, not notifications.**
  The write handler stores the response then ACKs (`protocomm_ble.c:316-322`); the read handler
  returns it (`protocomm_ble.c:155-209`; NimBLE `:356-364`/`:418`). **No `0x2902` CCCD exists
  anywhere**, and the firmware never pushes notify/indicate. ⇒ the client's write-then-read,
  notifications-unused design is correct. (A `NOTIFY` *property* bit can be added via
  `CONFIG_WIFI_PROV_BLE_NOTIFY`, but that Kconfig **defaults off** and, even when on, the
  firmware still only does read-back — a *notify-only* client would be the broken one.)
- **No app-layer fragmentation**, matching §2.2/§15-14 — but two GATT-layer caveats:
  - **Inbound size ceiling.** Bluedroid caps a characteristic value at `CHAR_VAL_LEN_MAX` =
    **481 B** for Security2, **257 B** for Security1 (`protocomm_ble.c:26-30`); an oversized
    write is rejected with `ESP_GATT_INVALID_ATTR_LEN`. The SRP-6a A/B values (~384 B) fit
    under Sec2's 481 but **exceed Sec1's 257** — not an issue (SRP is Sec2 only), but any large
    Sec1 payload would be truncated. (NimBLE has no equivalent inbound cap.)
  - **Outbound long-read.** A response larger than `MTU − 1` is delivered via standard GATT
    **Read Blob** (multi-read by offset, `protocomm_ble.c:180-198`), transparent to a client
    that supports long reads. With MTU 512 and the 481-byte cap, a single read normally
    suffices, but a client that negotiates a **smaller** MTU must implement ATT Read Blob or it
    will silently get a truncated response. The Android client requests MTU 512 (§2.2), so this
    is usually moot — but worth hardening.
- **Default service UUID** base is `0000ffff-...` (`scheme_ble.c:118-123`), overridable by the
  app; endpoint 16-bit UUIDs (`0xFF4F`–`0xFF53`) are overlaid on the base. Confirms §2.1's "not
  hard-coded; learn it from the advertisement/QR."

### 16.5 Application-flow behavioral notes (non-breaking, but encode defensively)

From `handlers.c`, `wifi_config.c`, `wifi_scan.c`, `wifi_ctrl.c`, `manager.c`:

- **Endpoint names match exactly:** `prov-session`, `prov-scan`, `prov-config`, `prov-ctrl`,
  `proto-ver` (`manager.c:318/356/376/398/421`). `cloud`/custom endpoints are **not** part of
  the core component — they are app-registered via `wifi_prov_mgr_endpoint_register`
  (`manager.c:507`), consistent with §11/§12.
- **Scan results are capped at `CONFIG_WIFI_PROV_SCAN_MAX_ENTRIES`, default 16**
  (`wifi_scan.c:139-145`, Kconfig). The batch-of-4 pagination (§8.3) is fine, but a scan with
  >16 APs is **truncated by the firmware** — page only up to `result_count`, and don't assume
  it reflects the full RF environment.
- **`CmdSetWifiConfig` input validation** (`wifi_config.c:163-180`): `bssid` must be **length 0
  or exactly 6** (else `InvalidArgument`); **SSID must be < 32 bytes**, **passphrase < 64
  bytes** (the firmware rejects `>=`). The client sends only ssid/passphrase by default
  (channel/bssid default 0), which is accepted.
- **Status reporting quirk:** on STA disconnect the firmware reports `WifiStationState =
  ConnectionFailed (3)`, **never `Disconnected (2)`** (`wifi_config.c:114`). So the client's
  `Disconnected → DEVICE_DISCONNECTED` polling branch (§9.3) is effectively **unreachable** on
  v5.2.7; auth/credential failures arrive as `ConnectionFailed` + `WifiConnectFailedReason`
  (`AuthError=0` / `NetworkNotFound=1`). Don't treat the absence of a `Disconnected` state as
  anomalous.
- **Scan params are honored verbatim** (`handlers.c:161`): `period_ms=120`, `blocking=true`,
  etc. are passed straight through; `blocking=true` runs the scan synchronously but the client
  should still poll `ScanStatus` as the spec describes.

### 16.6 Confirmed full matches (no action needed)

- **Security 0** — identity encrypt/decrypt, single empty-command round (`security0.c`).
- **Security 1** — X25519 32-B shared secret; `shared ^= SHA256(PoP)` only when PoP set
  (`security1.c:336-350`); AES-256-CTR, key=shared, IV=`device_random` (16 B); **one
  continuous CTR stream** initialized once (`nc_off`/state at `security1.c:120-122`),
  `encrypt == decrypt` (`security1.c:640-641`); `client_verify`/`device_verify` semantics as
  in §6.2. Fully wire-compatible.
- **Protobuf field-number quirks** — `SessionCmd1.client_verify_data = 2` (no field 1),
  `SessionResp1.device_verify_data = 3`, `SessionData.sec_ver = 2`, `S2SessionCmd0
  {client_username=1, client_pubkey=2}`, `Status` enum `0..7` — all confirmed in
  `protocomm/proto/{session,sec1,sec2,constants}.proto`.
- **Big-integer encoding** — firmware `esp_mpi_to_bin` emits minimal big-endian (leading zeros
  stripped) and feeds `A/B/salt` into `M1` as those same minimal-length bytes, so the client
  must hash exactly the bytes it puts on the wire (§6.3/§15-10). Confirmed.
- **`WifiAuthMode`** includes `WPA3_PSK=6` and `WPA2_WPA3_PSK=7` in v5.2.7 (`wifi_constants.proto`)
  — the client's full 0..7 enum is correct, not truncated.

### 16.7 Action checklist for the client

1. **Drop / hard-gate the Sec2 16-byte-nonce mode.** Only the 12-byte `session_id ‖ BE32(counter)`
   scheme with `counter` starting at 1 interoperates; never select 16-byte mode on a missing
   `sec_patch_ver`. (§16.1)
2. **Gate Thread on firmware capability.** Do not offer Thread provisioning to a device whose
   `proto-ver` is the v5.2.7 `wifi_provisioning` component. (§16.2)
3. **Tolerate extra capabilities** (`wifi_scan`) and the `no_sec`/`no_pop` distinction. (§16.3)
4. **Support ATT Read Blob** for responses > MTU−1 if you ever negotiate MTU < the response
   size; keep requesting MTU 512. (§16.4)
5. **Page scans only up to `result_count`** (≤16 by default) and pre-validate SSID < 32 /
   passphrase < 64 / bssid ∈ {0,6} bytes to avoid `InvalidArgument`. (§16.5)
6. **Expect `ConnectionFailed`, not `Disconnected`,** on credential/RF failures. (§16.5)

---

## 17. Python Client Implementation Notes (v5.2.7-exact)

> **Purpose.** Concrete, byte-exact guidance for building/updating a **Python** BLE client
> (e.g. with `bleak`) against a **v5.2.7 `wifi_provisioning`** device. Every constant here was
> read out of the firmware at tag `v5.2.7`; `file:line` points into the ESP-IDF tree. Where the
> earlier sections describe the *Android* client, this section tells you exactly what the
> *device* does and how to mirror it in Python. **Implement the Wi-Fi path only** (no Thread on
> v5.2.7), and **use the Sec2 patched/12-byte-nonce scheme** (the only one that exists).

### 17.1 Recommended Python stack

| Concern | Library | Notes |
|---|---|---|
| BLE GATT | **`bleak`** | Cross-platform; async. Use `BleakClient` + `BleakScanner`. |
| Protobuf | **`protobuf`** (`grpcio-tools`/`protoc` to generate) | Compile the v5.2.7 `wifi_*`/`protocomm` `.proto` files (see §17.7). |
| X25519 + AES-CTR/GCM + SHA | **`cryptography`** (`hazmat`) | `X25519PrivateKey`, `Cipher(AES, CTR)`, `AESGCM`, `hashes`. |
| SRP-6a (Sec2) | **hand-rolled** with `hashlib` + Python `int` | No off-the-shelf lib matches Espressif's M1 variant — implement §17.5. |

### 17.2 BLE: exact UUIDs, GATT ops, MTU (v5.2.7 defaults)

**Default 128-bit provisioning service UUID** (`scheme_ble.c:118-123`). The firmware stores the
16 bytes **LSB-first**; as a canonical (MSB-first) UUID string it is:

```
service:  1775244d-6b43-439b-877c-060f2d9bed07
```

**Per-endpoint characteristic UUIDs** = that base with the 16-bit endpoint id overlaid at byte
offset [12..13] (`protocomm_ble.c:133-135,628-630`; ids from `manager.c:1349-1377`):

| Endpoint        | 16-bit id | Characteristic UUID (default base)        |
|-----------------|-----------|-------------------------------------------|
| `prov-ctrl`     | `0xFF4F`  | `1775ff4f-6b43-439b-877c-060f2d9bed07`    |
| `prov-scan`     | `0xFF50`  | `1775ff50-6b43-439b-877c-060f2d9bed07`    |
| `prov-session`  | `0xFF51`  | `1775ff51-6b43-439b-877c-060f2d9bed07`    |
| `prov-config`   | `0xFF52`  | `1775ff52-6b43-439b-877c-060f2d9bed07`    |
| `proto-ver`     | `0xFF53`  | `1775ff53-6b43-439b-877c-060f2d9bed07`    |

> ⚠️ **Do not hard-code these.** The service UUID is overridable
> (`wifi_prov_scheme_ble_set_service_uuid`, `scheme_ble.c:83`) and RainMaker/other firmwares use a
> different base. The **only portable** mapping is to read the **`0x2901`** Characteristic User
> Description of each characteristic and match its UTF-8 value to the endpoint name (§2.3). Treat
> the table above as a fallback/sanity-check, not the source of truth. App-registered custom
> endpoints get incremental ids from `0xFF54` upward (`manager.c:1380`).

**GATT op recipe (`bleak`):**

```python
# discover endpoint name -> characteristic
for ch in service.characteristics:
    for d in ch.descriptors:
        if d.uuid[4:8].lower() == "2901":
            name = (await client.read_gatt_descriptor(d.handle)).decode("utf-8")
            endpoint[name] = ch

async def transact(ch, payload: bytes) -> bytes:
    await client.write_gatt_char(ch, payload, response=True)   # WRITE WITH RESPONSE
    return bytes(await client.read_gatt_char(ch))              # READ the response back
```

- **Write-with-response, then read** — the device parks its reply in the same characteristic
  value (`protocomm_ble.c:316-322`, read at `:155-209`). **No notifications** are ever sent (no
  `0x2902` CCCD exists); never await a notify. Serialize: **one transaction in flight at a time**.
- **Request MTU 512.** Bleak: `BleakClient(addr, ...)`; on most backends MTU is auto-negotiated —
  on BlueZ you may need `await client._backend._acquire_mtu()` or rely on the default. The
  firmware caps a single characteristic value at **`CHAR_VAL_LEN_MAX`** = **481 bytes** when
  Security2 is compiled in, **257 bytes** otherwise (`protocomm_ble.c:26-30`). A request larger
  than that is rejected (`ESP_GATT_INVALID_ATTR_LEN`). The largest request you send is the SRP-6a
  `A` (~384 B) → fits under 481 (Sec2) but **not** under 257 (Sec1-only build). 
- **Long reads:** if a response exceeds `MTU − 1`, the firmware serves it via ATT **Read Blob**
  (`protocomm_ble.c:180-198`). `bleak`'s `read_gatt_char` handles this transparently on most
  backends; just don't assume a one-shot read if you negotiated a small MTU.

### 17.3 `proto-ver` (plaintext) — exact request/response

- **Write** the literal bytes `b"ESP"` to the `proto-ver` characteristic, then **read**. (The
  firmware **ignores the request bytes entirely** — `protocomm.c:366-388` — so any payload
  returns the same JSON; send `b"ESP"` for convention.)
- **Read** a UTF-8 **JSON** doc. Exact shape the firmware emits (`manager.c:247-284`):

```json
{ "prov": { "ver": "v1.1", "sec_ver": 2, "sec_patch_ver": 1, "cap": ["wifi_scan"] } }
```

Parse under `prov`: `sec_ver` (int — select Sec0/1/2), `sec_patch_ver` (int), `cap` (array).
v5.2.7 specifics:
- `ver` is always `"v1.1"` (`WIFI_PROV_MGR_VERSION`, `manager.c:28`).
- `cap` **always contains `"wifi_scan"`** (`manager.c:280`) and **at most one** of `"no_sec"`
  (Security0) or `"no_pop"` (Sec1/2 with no PoP) — never both (`manager.c:273-277`). Tolerate
  unknown cap strings.
- With Security2 the device reports `sec_ver=2, sec_patch_ver=1`. **Trust `sec_patch_ver`; do not
  default it to 0** (see §17.6).

### 17.4 Security 1 — Python recipe (single continuous AES-256-CTR)

```python
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
import hashlib

priv = X25519PrivateKey.generate()
client_pub = priv.public_key().public_bytes_raw()          # 32 B
# -> send SessionCmd0{client_pubkey=client_pub}; recv SessionResp0{device_pubkey, device_random}
shared = priv.exchange(load_x25519_public(device_pubkey))  # 32 B
if pop:                                                     # only if PoP set
    shared = bytes(a ^ b for a, b in zip(shared, hashlib.sha256(pop).digest()))
enc = Cipher(algorithms.AES(shared), modes.CTR(device_random)).encryptor()  # IV = 16 B device_random
client_verify = enc.update(device_pubkey)                  # first keystream use, 32 B
# -> send SessionCmd1{client_verify_data=client_verify}; recv SessionResp1{device_verify_data}
assert enc.update(device_verify_data) == client_pub        # SAME stream continues

# application messages forever after — ONE stateful stream, both directions:
def encrypt(pt):  return enc.update(pt)
def decrypt(ct):  return enc.update(ct)
```

- **Critical:** keep the single `enc` object for the whole session. `encrypt` and `decrypt` both
  call `enc.update()`; the CTR counter advances across every byte in call order
  (`security1.c:120-122,640-641`). Never re-create the cipher. Field numbers:
  `client_verify_data` is field **2** (no field 1); `device_verify_data` is field **3**.

### 17.5 Security 2 — Python recipe (SRP-6a + AES-256-GCM, patched nonce)

**Parameters** (`esp_srp.c:70-97`): RFC 5054 **3072-bit** `N`, `g=5`, `H=SHA-512`, `len_N=384`.

```python
import hashlib, os
H = lambda *p: hashlib.sha512(b"".join(p)).digest()
PAD = lambda x: x.rjust(384, b"\x00")                      # left-pad to len_N
i2b = lambda i: i.to_bytes((i.bit_length()+7)//8, "big")  # minimal big-endian
b2i = lambda b: int.from_bytes(b, "big")

# Step0: A = g^a mod N (random a); send S2SessionCmd0{client_username=user(utf8), client_pubkey=i2b(A)}
# recv  S2SessionResp0{device_pubkey=B, device_salt=s}
s, B = device_salt, b2i(device_pubkey)
u = b2i(H(PAD(i2b(A)), PAD(i2b(B))))
k = b2i(H(PAD(N_bytes), PAD(i2b(g))))                      # N_bytes = i2b(N) (== 384 B)
x = b2i(H(s, H(user.encode() + b":" + pop)))              # XRoutineWithUserIdentity
S = pow(B - k*pow(g, x, N), a + u*x, N)
K = H(i2b(S))                                             # 64 B shared key

# Espressif M1 variant (esp_srp.c:624-653) — NOT plain RFC5054:
c   = bytes(p ^ q for p, q in zip(H(PAD(N_bytes)), H(PAD(i2b(g)))))   # SHA512(PAD N) XOR SHA512(PAD g)
M1  = H(c, H(user.encode()), s, i2b(A), i2b(B), K)        # send S2SessionCmd1{client_proof=M1}
# recv S2SessionResp1{device_proof=M2, device_nonce}
assert M2 == H(i2b(A), M1, K)                             # RFC5054 server evidence (esp_srp.c:665-670)

key   = K[:32]                                            # AES-256 key = FIRST 32 B of K
```

**GCM application cipher — the patched 12-byte counter nonce (the ONLY mode in v5.2.7):**

```python
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import struct
aes = AESGCM(key)
# device_nonce is EXACTLY 12 bytes: session_id[0..7] || big-endian uint32 counter (security2.c:46,277,310)
prefix  = device_nonce[0:8]
counter = struct.unpack(">I", device_nonce[8:12])[0]      # == 1 on a fresh session (htobe32(1))

def _nonce():
    global counter
    n = prefix + struct.pack(">I", counter & 0xFFFFFFFF)
    counter = (counter + 1) & 0xFFFFFFFF                  # post-increment on EVERY op (enc AND dec)
    return n

def encrypt(pt): return aes.encrypt(_nonce(), pt, None)   # returns ciphertext || 16-B tag, no AAD
def decrypt(ct): return aes.decrypt(_nonce(), ct, None)   # ct = ciphertext || 16-B tag
```

- **One shared `counter` for both directions**, advanced once per GCM op in strict
  request→response call order (`security2.c:505,552` increment after each
  `crypt_and_tag`/`auth_decrypt`). Starting value is whatever `device_nonce[8..11]` decodes to —
  always **1** on v5.2.7. After the handshake the client encrypts first (counter=1), the device
  decrypts (1→2), the device encrypts its reply (counter=2→3), the client decrypts (counter=2),
  etc. Mismatched counters → GCM tag failure on the 2nd message onward.
- `AESGCM.encrypt` returns **ciphertext ‖ 16-byte tag** with **no AAD** — byte-identical to the
  firmware (`security2.c:495-502`). Don't set AAD.
- **Do NOT implement the §6.3 "v0 / full-16-byte reused nonce" branch.** It does not exist in
  firmware and will break on message #2. (See §16.1.)

Wire encodings for Sec2 integers (`A`, `B`, `s`, `M1`, `M2`) are **minimal unsigned big-endian**
(`i2b` above) — strip leading `0x00`. Inside `M1`, `N` and `g` are **PAD-to-384**, but `A`/`B`/`s`
are the minimal-length bytes you put on/took off the wire.

### 17.6 Sequencing & the encrypted-application wrapper

After the handshake, **every** non-`proto-ver`/`prov-session` transaction is:
`cipher_in = encrypt(plaintext_protobuf)` → `write+read` → `plaintext_out = decrypt(cipher_out)`.
Because both Sec1 (CTR) and Sec2 (GCM counter) are **stateful and order-sensitive**, you must:
1. fully serialize transactions (one outstanding write/read at a time), and
2. call `encrypt`/`decrypt` in exactly the send/receive order — a dropped/retried BLE op desyncs
   the keystream/counter and is unrecoverable without re-handshaking.

### 17.7 Protobuf: compile the v5.2.7 protos (names differ from the Android `network_*`)

Generate from the **firmware** protos so message names match v5.2.7:
`components/protocomm/proto/{session,sec0,sec1,sec2,constants}.proto` and
`components/wifi_provisioning/proto/{wifi_config,wifi_scan,wifi_ctrl,wifi_constants}.proto`.
The Android client's `Network*Payload`/`network_*` names are a **newer** component; on the wire
the Wi-Fi subset is **field-for-field identical** (§16.2), so either set of generated classes
interoperates — but if you want names to match the device, use `WiFiConfigPayload` /
`WiFiScanPayload` / `WiFiCtrlPayload`. **No Thread messages exist in v5.2.7** — don't emit them.

### 17.8 Application-flow constants the device enforces (validate client-side first)

- **Set Wi-Fi config** (`wifi_config.c:163-180`): **SSID < 32 bytes**, **passphrase < 64 bytes**,
  **`bssid` length ∈ {0, 6}** — else `Status.InvalidArgument(4)`. Pre-validate before sending.
- **Scan** (`wifi_scan.c:139-145`): results capped at `CONFIG_WIFI_PROV_SCAN_MAX_ENTRIES`
  (**default 16**). Page in batches (≤4 works) but only up to `result_count`; a >16-AP environment
  is truncated by the device. `CmdScanWifiStart{blocking=true, passive=false, group_channels=0,
  period_ms=120}` is passed through verbatim (`handlers.c:161`).
- **Status polling** (`wifi_config.c:114`): on failure the device reports
  `WifiStationState = ConnectionFailed (3)`, **never `Disconnected (2)`**. Read
  `WifiConnectFailedReason` (`AuthError=0` / `NetworkNotFound=1`, value names per
  `wifi_constants.proto`). Your `Disconnected → DEVICE_DISCONNECTED` branch will not fire on
  v5.2.7. After `ApplyWifiConfig`, wait ~2 s, then poll every ~5 s while `Connecting (1)`.
- **Ctrl** (`wifi_ctrl.c`): `TypeCmdCtrlWifiReset=1` (clear creds), `TypeCmdCtrlWifiReprov=3`
  (restart provisioning); oneof tag for `cmd_ctrl_wifi_reset` is **11**.

### 17.9 Quick-reference constants (all v5.2.7)

| Constant | Value | Source |
|---|---|---|
| Sec2 GCM IV size | **12 bytes** (`session_id[8] ‖ be32(counter)`) | `security2.c:38,46` |
| Sec2 counter init | **1** (`htobe32(0x1)`) | `security2.c:277` |
| Sec2 `device_nonce` len | **12** | `security2.c:310` |
| Sec2 GCM tag | **16 bytes**, appended, **no AAD** | `security2.c:38,495-502` |
| Sec2 AES key | **first 32 B of `K=SHA512(S)`** | `security2.c:284` |
| Sec2 advertised `patch_ver` | **1** | `security2.c:620` |
| Sec1 cipher | AES-256-**CTR**, IV=16-B `device_random`, single stream | `security1.c:53,120-122` |
| Sec1 PoP mix | `shared ^= SHA256(PoP)` if PoP set | `security1.c:336-350` |
| Max char value | **481 B** (Sec2 build) / **257 B** (Sec1-only) | `protocomm_ble.c:26-30` |
| Default service UUID | `1775244d-6b43-439b-877c-060f2d9bed07` | `scheme_ble.c:118-123` |
| Endpoint ids | ctrl `FF4F`, scan `FF50`, session `FF51`, config `FF52`, ver `FF53` | `manager.c:1349-1377` |
| `proto-ver` JSON | `prov.{ver,sec_ver,sec_patch_ver,cap[]}`; cap always has `wifi_scan` | `manager.c:247-284` |

---

## 18. `esp_wifi_config` Library Specifics (hardware-verified, IDF 5.4.3)

> **Scope.** §1–17 describe the generic ESP-IDF provisioning protocol (derived from the
> Android client, cross-checked against firmware v5.2.7). This section documents the
> behaviors and **custom endpoints specific to the `esp_wifi_config` library** that this
> repo ships, plus everything **empirically verified on real hardware** — an ESP32-D0WDQ6
> running the `examples/with_ble` firmware on **ESP-IDF 5.4.3** (NimBLE, in-tree
> `wifi_provisioning`). This is the section to implement against when building the React
> Native library and the iOS/Android apps that talk to *this* firmware.

### 18.1 What was confirmed on the wire (IDF 5.4.3)

- The full protocol of §1–17 holds on 5.4.3. **Security 0, 1, and 2 all interoperate.**
- **Security 2 / GCM:** `proto-ver` reports `sec_ver=2, sec_patch_ver=1`; `device_nonce` is
  **12 bytes** (`session_id[8] ‖ BE32(counter)`), counter starts at **1**, and is
  **post-incremented on every encrypt *and* decrypt** (the patched 12-byte scheme — the only
  one that exists). A full multi-message GCM session (handshake → set → apply → repeated
  status polls) was verified end-to-end with no auth-tag failures. **Do not implement the
  legacy 16-byte reused-nonce mode** (§16.1).
- **`proto-ver` JSON:** `ver = "v1.1"`; `cap` always contains `"wifi_scan"`; plus exactly one
  of `"no_sec"` (Security 0) or `"no_pop"` (Sec1/2 with no PoP) — never both. `sec_patch_ver`
  is `1` for Sec2 and `0` for Sec0/Sec1. Tolerate unknown capability strings.
- **Default service UUID base** (no custom UUID set) is `1775244d-6b43-439b-877c-060f2d9bed07`
  with endpoint ids `0xFF4F`–`0xFF53` (§17.2) — confirmed in IDF 5.4.3 `scheme_ble.c`. Still,
  **discover endpoints via the `0x2901` descriptor**; the app may override the base via a
  custom 128-bit UUID, in which case the advertised UUID is the source of truth.
- **`wifi_attempt_failed` (RespGetWifiStatus oneof tag 12)** is emitted by 5.4.x firmware —
  see §9.3. Clients must tolerate it.
- **Security 2 requires a device-side salt + verifier.** This is a *device-config* requirement,
  not a wire/client one: the firmware refuses to start the Sec2 provisioning manager unless a
  pre-computed SRP6a `salt` + `verifier` are supplied (`wifi_cfg_prov_validate()` →
  `ESP_ERR_INVALID_ARG`). The raw PoP alone is insufficient — SRP6a stores a password-derived
  verifier, never the password. Generate offline from a username + password, e.g.
  `esp_prov.py --transport ble --sec_ver 2 --sec2_gen_cred --sec2_username <user> --sec2_pwd <pw>`,
  and embed the bytes in firmware. The client then authenticates with that same username +
  password. (Sec0/Sec1 need nothing extra.)
- **End-to-end verified through the React Native library + Espressif ESPProvision SDK** (not just
  the Python oracle): Security 0, 1, and 2 each provisioned a real device to Wi-Fi (`Got IP`) from
  an iOS app built on `esp-wifi-config-react-native` → `@orbital-systems/react-native-esp-idf-provisioning`
  → ESPProvision. The only client-visible gap: the native SDK's `provision()` returns just a status
  string and **drops the device IP** (`WifiConnectedState.ip4_addr`), so the IP is not surfaced to
  app code — fetch it out-of-band (firmware HTTP `GET <api_base>/status` returns `ip`, or mDNS).

### 18.2 Provisioning lifecycle & reboot-on-success — **read this for client UX**

By default this library, on successful provisioning (credentials accepted → STA gets IP),
**tears down the provisioning interfaces after a delay and reboots the device**. Concretely
(verified): on `Got IP` the firmware schedules a teardown (default ~5 s) and a backstop reboot
(`reboot_max_wait_ms`, **default 15 s**), or reboots **immediately when the BLE client
disconnects** after credentials succeed. So:

- After `CmdApplyWifiConfig`, **poll `CmdGetWifiStatus`** (§9.3). `Connecting` → keep polling;
  `wifi_attempt_failed` → keep polling; `Connected` → **success**.
- **A BLE disconnect that happens right after Apply / around the time the device connects is
  EXPECTED and almost always means success**, because the device tore down BLE and rebooted.
  Do **not** present this mid-poll GATT drop as a provisioning error. The correct app flow is:
  treat "saw `Connected`" **or** "link dropped shortly after Apply" as success, then confirm
  out-of-band (the device rejoins the network and, e.g., appears on the LAN / stops
  advertising `PROV_…`).
- This auto-reboot can be disabled in firmware (`disable_reboot_on_provisioning_success`), and
  teardown-on-connect via `stop_provisioning_on_connect` — but the **shipping defaults reboot**,
  so the app must handle the disconnect-on-success case gracefully.

> ⚠️ **Reboot-vs-poll race (root cause of "provisioning intermittently reports failure").**
> The backstop reboot delay **must comfortably exceed the client's status-poll interval**.
> Espressif's ESPProvision SDK (iOS/Android) polls `CmdGetWifiStatus` every **~5 s** and only
> reports success when a poll observes `Connected`; it does **not** treat a post-apply BLE
> disconnect as success. The device's `Connected → reboot` window is short, so with the old
> **3 s** backstop the device could reboot in the gap *between two 5 s client polls* — after it
> had actually joined Wi-Fi but before the client ever saw `Connected`. The client then polled a
> rebooted/dead link and reported a **false failure** even though provisioning succeeded. This
> was timing-dependent (it bit Security 2 first, whose slower SRP6a handshake delays the connect
> past the first poll; Sec0/Sec1 often "won the race" by luck). **Fix (firmware):** the default
> `reboot_max_wait_ms` was raised **3 s → 15 s** (≈3 poll cycles of headroom) so a well-behaved
> client always observes `Connected` and disconnects cleanly (which then triggers the immediate
> disconnect-path reboot anyway). A robust client should *also* treat a post-apply disconnect as
> success per the guidance above — belt and suspenders.

### 18.3 Reconnect behavior (sessions are not resumable)

A client may connect, transact, disconnect, and **reconnect repeatedly**; the device
re-advertises (`PROV_<id>`, where `<id>` = last 3 bytes of the STA MAC in uppercase hex)
after each disconnect. **Every new connection re-runs `proto-ver` + the full security
handshake from scratch** — there is no session resumption, and the Sec1 CTR stream / Sec2 GCM
counter reset per connection. Serialize: one GATT transaction (write-then-read) in flight at a
time, one connection at a time.

### 18.4 `prov-ctrl` reset / reprovision — state-gated

`CmdCtrlWifiReset` (msg type 1) and `CmdCtrlWifiReprov` (msg type 3) are accepted only in
specific manager states: **RESET requires the provisioning state machine to be in the FAIL
state**; **REPROV requires the device to be provisioned**. Outside those states the device
answers with a **non-`Success` `Status`** (the command is still delivered and a response is
returned — it is *not* silently dropped). **Always check the response `Status`; never assume
success.** Note the library also auto-resets the state machine after `max_failed_attempts`
credential failures, which can race a manual reset.

### 18.5 Library-extension custom endpoints (JSON over the session cipher)

This library **always registers** four custom endpoints (no feature flag). They are
discovered via `0x2901` like any endpoint (names below), and their payloads pass through the
**negotiated session cipher exactly like `prov-config`** (encrypt request, decrypt response).
Requests/responses are **UTF-8 JSON**. The **zero-length-write gotcha (§12) applies** — for the
read-only endpoints that take no input, send the one-byte-plus body `{}` (an empty request
returns nothing).

| Endpoint (`0x2901` name)          | Request JSON                              | Response JSON |
|-----------------------------------|-------------------------------------------|---------------|
| `esp-wifi-config-version`         | *(ignored; send `{}`)*                    | `{ "lib", "idf", "app", "fw_version", "compile_time", "firmware_version", "chip" }` |
| `esp-wifi-config-capabilities`    | *(ignored; send `{}`)*                    | `{ "capabilities": [..], "max_networks": <int>, "max_vars": <int> }` |
| `esp-wifi-config-network-policy`  | *(ignored; send `{}`)*                    | `{ "provisioning_mode", "max_retry_per_network", "retry_interval_ms", "retry_max_interval_ms", "auto_reconnect", "max_reconnect_attempts", "saved_networks" }` |
| `esp-wifi-config-vars`            | `{ "op": "list\|get\|set\|del", "key": "..", "value": ".." }` | see below |

`capabilities` array may contain any of: `"multi-network"`, `"custom-vars"`,
`"improv-serial"`, `"webui"`, `"cli"`, `"softap"` (depends on firmware Kconfig).
`provisioning_mode` is one of `"always"`, `"on_failure"`, `"when_unprovisioned"`, `"manual"`.

**`esp-wifi-config-vars`** responses (verified):

```
op=list                       -> { "vars": [ { "k": "<key>", "v": "<value>" }, ... ] }
op=get  (found)               -> { "key": "<key>", "value": "<value>" }
op=get  (missing)             -> { "error": "not_found" }      // or "missing_key"
op=set  (ok)                  -> { "ok": true }                // or {"error":"store_full"|"rejected"|"missing_key_or_value"}
op=del  (ok)                  -> { "ok": true }                // missing key -> { "ok": false, "error": "not_found" }
empty / non-JSON / bad op     -> { "error": "empty_request" | "bad_json" | "unknown_op" }
op omitted                    -> treated as "list"
```

Values are capped (firmware reads into a 128-byte buffer per value); `max_vars` /
`max_networks` come from `esp-wifi-config-capabilities`.

---

*End of specification. §1-15 derived from the Android client source in `provisioning/src/main/`;
§16-17 cross-checked against ESP-IDF firmware at tag `v5.2.7`
(`components/wifi_provisioning/`, `components/protocomm/`). §17 is byte-exact guidance for a
Python (`bleak`-based) Wi-Fi-provisioning client. §18 documents this repo's `esp_wifi_config`
library specifics and was verified on ESP32 hardware running `examples/with_ble` on IDF 5.4.3.*
