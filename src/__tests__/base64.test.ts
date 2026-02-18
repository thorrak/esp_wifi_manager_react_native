import { stringToBase64, base64ToString } from '../utils/base64';

describe('base64 utilities', () => {
  // --------------------------------------------------------------------------
  // Round-trip: ASCII
  // --------------------------------------------------------------------------

  describe('ASCII round-trip', () => {
    it('encodes and decodes a simple string', () => {
      const input = 'Hello, World!';
      expect(base64ToString(stringToBase64(input))).toBe(input);
    });

    it('handles all printable ASCII characters', () => {
      let input = '';
      for (let i = 32; i < 127; i++) {
        input += String.fromCharCode(i);
      }
      expect(base64ToString(stringToBase64(input))).toBe(input);
    });

    it('handles lowercase alphabet', () => {
      const input = 'abcdefghijklmnopqrstuvwxyz';
      expect(base64ToString(stringToBase64(input))).toBe(input);
    });

    it('handles digits', () => {
      const input = '0123456789';
      expect(base64ToString(stringToBase64(input))).toBe(input);
    });
  });

  // --------------------------------------------------------------------------
  // Round-trip: JSON payloads (the protocol use case)
  // --------------------------------------------------------------------------

  describe('JSON payload round-trip', () => {
    it('handles a command envelope', () => {
      const json = JSON.stringify({ cmd: 'get_status' });
      expect(base64ToString(stringToBase64(json))).toBe(json);
    });

    it('handles a command with params', () => {
      const json = JSON.stringify({
        cmd: 'add_network',
        params: { ssid: 'MyWifi', password: 's3cret!', priority: 10 },
      });
      expect(base64ToString(stringToBase64(json))).toBe(json);
    });

    it('handles a success response', () => {
      const json = JSON.stringify({
        status: 'ok',
        data: {
          state: 'connected',
          ssid: 'MyWifi',
          rssi: -45,
          ip: '192.168.1.100',
        },
      });
      expect(base64ToString(stringToBase64(json))).toBe(json);
    });

    it('handles an error response', () => {
      const json = JSON.stringify({
        status: 'error',
        error: 'Network not found',
      });
      expect(base64ToString(stringToBase64(json))).toBe(json);
    });

    it('handles a scan response with nested arrays', () => {
      const json = JSON.stringify({
        status: 'ok',
        data: {
          networks: [
            { ssid: 'Network1', rssi: -40, auth: 'WPA2' },
            { ssid: 'Network2', rssi: -65, auth: 'OPEN' },
            { ssid: 'Network3', rssi: -80, auth: 'WPA/WPA2' },
          ],
        },
      });
      expect(base64ToString(stringToBase64(json))).toBe(json);
    });
  });

  // --------------------------------------------------------------------------
  // Round-trip: Unicode
  // --------------------------------------------------------------------------

  describe('unicode round-trip', () => {
    it('handles accented Latin characters', () => {
      const input = 'cafe\u0301 re\u0301sume\u0301';
      expect(base64ToString(stringToBase64(input))).toBe(input);
    });

    it('handles CJK characters', () => {
      const input = '\u4f60\u597d\u4e16\u754c';
      expect(base64ToString(stringToBase64(input))).toBe(input);
    });

    it('handles emoji (surrogate pairs)', () => {
      const input = '\u{1F600}\u{1F680}\u{1F4BB}';
      expect(base64ToString(stringToBase64(input))).toBe(input);
    });

    it('handles mixed ASCII and unicode', () => {
      const input = 'Hello \u4e16\u754c! \u{1F44D}';
      expect(base64ToString(stringToBase64(input))).toBe(input);
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty string', () => {
      expect(stringToBase64('')).toBe('');
      expect(base64ToString('')).toBe('');
      expect(base64ToString(stringToBase64(''))).toBe('');
    });

    it('handles a single character', () => {
      expect(base64ToString(stringToBase64('A'))).toBe('A');
      expect(base64ToString(stringToBase64('z'))).toBe('z');
      expect(base64ToString(stringToBase64('0'))).toBe('0');
    });

    it('handles strings whose byte length is divisible by 3 (no padding)', () => {
      // "abc" = 3 bytes -> no padding
      const input = 'abc';
      const encoded = stringToBase64(input);
      expect(encoded).not.toContain('=');
      expect(base64ToString(encoded)).toBe(input);
    });

    it('handles strings that produce 1 pad character', () => {
      // "ab" = 2 bytes -> 1 pad char
      const encoded = stringToBase64('ab');
      expect(encoded.endsWith('=')).toBe(true);
      expect(encoded.endsWith('==')).toBe(false);
      expect(base64ToString(encoded)).toBe('ab');
    });

    it('handles strings that produce 2 pad characters', () => {
      // "a" = 1 byte -> 2 pad chars
      const encoded = stringToBase64('a');
      expect(encoded.endsWith('==')).toBe(true);
      expect(base64ToString(encoded)).toBe('a');
    });
  });

  // --------------------------------------------------------------------------
  // Known values (verified against standard base64 encoding)
  // --------------------------------------------------------------------------

  describe('known values', () => {
    it('encodes "Hello" correctly', () => {
      expect(stringToBase64('Hello')).toBe('SGVsbG8=');
    });

    it('encodes "Man" correctly (no padding)', () => {
      expect(stringToBase64('Man')).toBe('TWFu');
    });

    it('encodes "Ma" correctly (one pad)', () => {
      expect(stringToBase64('Ma')).toBe('TWE=');
    });

    it('encodes "M" correctly (two pads)', () => {
      expect(stringToBase64('M')).toBe('TQ==');
    });

    it('decodes "SGVsbG8gV29ybGQ=" to "Hello World"', () => {
      expect(base64ToString('SGVsbG8gV29ybGQ=')).toBe('Hello World');
    });

    it('encodes a JSON command envelope to expected base64', () => {
      const json = '{"cmd":"get_status"}';
      const expected = 'eyJjbWQiOiJnZXRfc3RhdHVzIn0=';
      expect(stringToBase64(json)).toBe(expected);
    });
  });
});
