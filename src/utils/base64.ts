/**
 * Base64 encode/decode utilities for BLE characteristic values.
 *
 * react-native-ble-plx uses base64 strings for all characteristic I/O.
 * These functions convert between UTF-8 strings and base64.
 */

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Encode a UTF-8 string to base64 */
export function stringToBase64(str: string): string {
  const bytes = encodeUTF8(str);
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    result +=
      b1 !== undefined
        ? BASE64_CHARS[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]
        : '=';
    result += b2 !== undefined ? BASE64_CHARS[b2 & 0x3f] : '=';
  }
  return result;
}

/** Decode a base64 string to UTF-8 */
export function base64ToString(base64: string): string {
  const bytes = decodeBase64ToBytes(base64);
  return decodeUTF8(bytes);
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  // Remove padding
  const cleaned = base64.replace(/=+$/, '');
  const length = (cleaned.length * 3) / 4;
  const bytes = new Uint8Array(Math.floor(length));

  let byteIndex = 0;
  for (let i = 0; i < cleaned.length; i += 4) {
    const a = BASE64_CHARS.indexOf(cleaned[i]!);
    const b = BASE64_CHARS.indexOf(cleaned[i + 1]!);
    const c = i + 2 < cleaned.length ? BASE64_CHARS.indexOf(cleaned[i + 2]!) : -1;
    const d = i + 3 < cleaned.length ? BASE64_CHARS.indexOf(cleaned[i + 3]!) : -1;

    bytes[byteIndex++] = (a << 2) | (b >> 4);
    if (c !== -1) bytes[byteIndex++] = ((b & 0x0f) << 4) | (c >> 2);
    if (d !== -1) bytes[byteIndex++] = ((c & 0x03) << 6) | d;
  }

  return bytes.slice(0, byteIndex);
}

function encodeUTF8(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code < 0xdc00) {
      // Surrogate pair
      const next = str.charCodeAt(++i);
      code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

function decodeUTF8(bytes: Uint8Array): string {
  let str = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b < 0x80) {
      str += String.fromCharCode(b);
      i++;
    } else if (b < 0xe0) {
      str += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      str += String.fromCharCode(
        ((b & 0x0f) << 12) |
          ((bytes[i + 1]! & 0x3f) << 6) |
          (bytes[i + 2]! & 0x3f),
      );
      i += 3;
    } else {
      const code =
        ((b & 0x07) << 18) |
        ((bytes[i + 1]! & 0x3f) << 12) |
        ((bytes[i + 2]! & 0x3f) << 6) |
        (bytes[i + 3]! & 0x3f);
      // Convert to surrogate pair
      const adjusted = code - 0x10000;
      str += String.fromCharCode(
        0xd800 + (adjusted >> 10),
        0xdc00 + (adjusted & 0x3ff),
      );
      i += 4;
    }
  }
  return str;
}
