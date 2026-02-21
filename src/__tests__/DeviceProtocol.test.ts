/**
 * Tests for the DeviceProtocol (Layer 2 — JSON command/response over BLE).
 *
 * We mock the BleTransport by providing a lightweight object that
 * satisfies the interface DeviceProtocol needs: on(), off(), and
 * writeCommand().
 */

// Provide a __DEV__ global for the logger module.
(globalThis as Record<string, unknown>).__DEV__ = false;

import { DeviceProtocol } from '../services/DeviceProtocol';

// ---------------------------------------------------------------------------
// Mock transport
// ---------------------------------------------------------------------------

class MockTransport {
  private responseCallback: ((json: string) => void) | null = null;

  on(event: string, callback: (...args: unknown[]) => void): () => void {
    if (event === 'response') {
      this.responseCallback = callback as (json: string) => void;
    }
    return () => {
      if (event === 'response') {
        this.responseCallback = null;
      }
    };
  }

  off(event: string, _callback?: unknown): void {
    if (event === 'response') {
      this.responseCallback = null;
    }
  }

  writeCommand = jest.fn().mockResolvedValue(undefined);

  /** Simulate a JSON response arriving from the device. */
  simulateResponse(json: string): void {
    this.responseCallback?.(json);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeviceProtocol', () => {
  let transport: MockTransport;
  let protocol: DeviceProtocol;

  beforeEach(() => {
    jest.useFakeTimers();
    transport = new MockTransport();
    protocol = new DeviceProtocol(transport as never);
  });

  afterEach(() => {
    protocol.destroy();
    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // sendCommand envelope formatting
  // --------------------------------------------------------------------------

  describe('sendCommand envelope', () => {
    it('sends the correct JSON envelope via writeCommand', async () => {
      const promise = protocol.sendCommand('get_status');
      // Let the writeCommand microtask settle.
      await jest.advanceTimersByTimeAsync(0);

      expect(transport.writeCommand).toHaveBeenCalledTimes(1);
      const written = JSON.parse(transport.writeCommand.mock.calls[0][0]);
      expect(written).toEqual({ cmd: 'get_status' });

      // Resolve the command so it cleans up.
      transport.simulateResponse(JSON.stringify({ status: 'ok', data: {} }));
      await promise;
    });

    it('includes params in the envelope when provided', async () => {
      const promise = protocol.sendCommand('add_network', {
        ssid: 'TestNet',
        password: 'secret',
      });
      await jest.advanceTimersByTimeAsync(0);

      const written = JSON.parse(transport.writeCommand.mock.calls[0][0]);
      expect(written).toEqual({
        cmd: 'add_network',
        params: { ssid: 'TestNet', password: 'secret' },
      });

      transport.simulateResponse(JSON.stringify({ status: 'ok', data: {} }));
      await promise;
    });

    it('omits params key when params are not provided', async () => {
      const promise = protocol.sendCommand('get_status');
      await jest.advanceTimersByTimeAsync(0);

      const written = JSON.parse(transport.writeCommand.mock.calls[0][0]);
      expect(written).not.toHaveProperty('params');

      transport.simulateResponse(JSON.stringify({ status: 'ok', data: {} }));
      await promise;
    });
  });

  // --------------------------------------------------------------------------
  // Response handling
  // --------------------------------------------------------------------------

  describe('response handling', () => {
    it('resolves with data on "ok" response', async () => {
      const promise = protocol.sendCommand('get_status');
      await jest.advanceTimersByTimeAsync(0);

      transport.simulateResponse(
        JSON.stringify({
          status: 'ok',
          data: { state: 'connected', ssid: 'MyWifi' },
        }),
      );

      const result = await promise;
      expect(result).toEqual({ state: 'connected', ssid: 'MyWifi' });
    });

    it('resolves with data on "success" response', async () => {
      const promise = protocol.sendCommand('scan');
      await jest.advanceTimersByTimeAsync(0);

      transport.simulateResponse(
        JSON.stringify({
          status: 'success',
          data: { networks: [{ ssid: 'Net1', rssi: -40, auth: 'WPA2' }] },
        }),
      );

      const result = await promise;
      expect(result).toEqual({
        networks: [{ ssid: 'Net1', rssi: -40, auth: 'WPA2' }],
      });
    });

    it('resolves with empty object when data is absent on ok response', async () => {
      const promise = protocol.sendCommand('disconnect');
      await jest.advanceTimersByTimeAsync(0);

      transport.simulateResponse(JSON.stringify({ status: 'ok' }));

      const result = await promise;
      expect(result).toEqual({});
    });

    it('rejects on "error" response with error message', async () => {
      const promise = protocol.sendCommand('connect');
      await jest.advanceTimersByTimeAsync(0);

      transport.simulateResponse(
        JSON.stringify({ status: 'error', error: 'Network not found' }),
      );

      await expect(promise).rejects.toThrow('Network not found');
    });

    it('rejects on "error" response using message field as fallback', async () => {
      const promise = protocol.sendCommand('connect');
      await jest.advanceTimersByTimeAsync(0);

      transport.simulateResponse(
        JSON.stringify({ status: 'error', message: 'Timeout reached' }),
      );

      await expect(promise).rejects.toThrow('Timeout reached');
    });

    it('rejects on invalid JSON response', async () => {
      const promise = protocol.sendCommand('get_status');
      await jest.advanceTimersByTimeAsync(0);

      transport.simulateResponse('not json at all');

      await expect(promise).rejects.toThrow('Invalid JSON response');
    });
  });

  // --------------------------------------------------------------------------
  // Busy state
  // --------------------------------------------------------------------------

  describe('busy state', () => {
    it('rejects if already busy', async () => {
      const first = protocol.sendCommand('get_status');
      await jest.advanceTimersByTimeAsync(0);

      await expect(protocol.sendCommand('scan')).rejects.toThrow(
        'Command already in progress',
      );

      // Clean up the first command.
      transport.simulateResponse(JSON.stringify({ status: 'ok', data: {} }));
      await first;
    });

    it('isBusy is true while a command is in-flight', async () => {
      expect(protocol.isBusy).toBe(false);

      const promise = protocol.sendCommand('get_status');
      await jest.advanceTimersByTimeAsync(0);

      expect(protocol.isBusy).toBe(true);

      transport.simulateResponse(JSON.stringify({ status: 'ok', data: {} }));
      await promise;

      expect(protocol.isBusy).toBe(false);
    });

    it('isBusy becomes false after an error response', async () => {
      const promise = protocol.sendCommand('connect');
      await jest.advanceTimersByTimeAsync(0);

      expect(protocol.isBusy).toBe(true);

      transport.simulateResponse(
        JSON.stringify({ status: 'error', error: 'fail' }),
      );

      await promise.catch(() => {});
      expect(protocol.isBusy).toBe(false);
    });

    it('emits busyChanged events', async () => {
      const busyChanges: boolean[] = [];
      protocol.on('busyChanged', (busy) => busyChanges.push(busy));

      const promise = protocol.sendCommand('get_status');
      await jest.advanceTimersByTimeAsync(0);

      transport.simulateResponse(JSON.stringify({ status: 'ok', data: {} }));
      await promise;

      expect(busyChanges).toEqual([true, false]);
    });
  });

  // --------------------------------------------------------------------------
  // Timeout
  // --------------------------------------------------------------------------

  describe('timeout', () => {
    it('rejects on timeout', async () => {
      const promise = protocol.sendCommand('get_status', undefined, 500);
      await jest.advanceTimersByTimeAsync(0);

      // Advance past the timeout.
      jest.advanceTimersByTime(600);

      await expect(promise).rejects.toThrow(/timed out/);
    });

    it('timeout clears busy state', async () => {
      const promise = protocol.sendCommand('get_status', undefined, 200);
      await jest.advanceTimersByTimeAsync(0);

      expect(protocol.isBusy).toBe(true);

      jest.advanceTimersByTime(300);
      await promise.catch(() => {});

      expect(protocol.isBusy).toBe(false);
    });

    it('emits commandError on timeout', async () => {
      const errors: Array<{ error: Error; cmd: string }> = [];
      protocol.on('commandError', (error, cmd) =>
        errors.push({ error, cmd }),
      );

      const promise = protocol.sendCommand('get_status', undefined, 100);
      await jest.advanceTimersByTimeAsync(0);

      jest.advanceTimersByTime(200);
      await promise.catch(() => {});

      expect(errors).toHaveLength(1);
      expect(errors[0]!.cmd).toBe('get_status');
      expect(errors[0]!.error.message).toMatch(/timed out/);
    });
  });

  // --------------------------------------------------------------------------
  // Typed command helpers
  // --------------------------------------------------------------------------

  describe('typed command helpers', () => {
    // Helper to assert the right command name is sent.
    async function assertCommandSent(
      invoke: () => Promise<unknown>,
      expectedCmd: string,
      expectedParams?: Record<string, unknown>,
    ): Promise<void> {
      const promise = invoke();
      await jest.advanceTimersByTimeAsync(0);

      expect(transport.writeCommand).toHaveBeenCalled();
      const written = JSON.parse(
        transport.writeCommand.mock.calls[
          transport.writeCommand.mock.calls.length - 1
        ][0],
      );
      expect(written.cmd).toBe(expectedCmd);
      if (expectedParams) {
        expect(written.params).toEqual(expectedParams);
      }

      transport.simulateResponse(JSON.stringify({ status: 'ok', data: {} }));
      await promise;
    }

    it('getStatus sends "get_status"', async () => {
      await assertCommandSent(() => protocol.getStatus(), 'get_status');
    });

    it('scan sends "scan"', async () => {
      await assertCommandSent(() => protocol.scan(), 'scan');
    });

    it('listNetworks sends "list_networks"', async () => {
      await assertCommandSent(
        () => protocol.listNetworks(),
        'list_networks',
      );
    });

    it('addNetwork sends "add_network" with params', async () => {
      await assertCommandSent(
        () =>
          protocol.addNetwork({ ssid: 'MyNet', password: 'pw', priority: 5 }),
        'add_network',
        { ssid: 'MyNet', password: 'pw', priority: 5 },
      );
    });

    it('delNetwork sends "del_network" with ssid param', async () => {
      await assertCommandSent(
        () => protocol.delNetwork('OldNet'),
        'del_network',
        { ssid: 'OldNet' },
      );
    });

    it('connectWifi sends "connect" with ssid param', async () => {
      await assertCommandSent(
        () => protocol.connectWifi('MyNet'),
        'connect',
        { ssid: 'MyNet' },
      );
    });

    it('connectWifi sends "connect" without params when ssid is omitted', async () => {
      const promise = protocol.connectWifi();
      await jest.advanceTimersByTimeAsync(0);

      const written = JSON.parse(
        transport.writeCommand.mock.calls[
          transport.writeCommand.mock.calls.length - 1
        ][0],
      );
      expect(written.cmd).toBe('connect');
      expect(written).not.toHaveProperty('params');

      transport.simulateResponse(JSON.stringify({ status: 'ok', data: {} }));
      await promise;
    });

    it('disconnectWifi sends "disconnect"', async () => {
      await assertCommandSent(
        () => protocol.disconnectWifi(),
        'disconnect',
      );
    });

    it('getApStatus sends "get_ap_status"', async () => {
      await assertCommandSent(
        () => protocol.getApStatus(),
        'get_ap_status',
      );
    });

    it('startAp sends "start_ap" with optional params', async () => {
      await assertCommandSent(
        () => protocol.startAp({ ssid: 'MyAP', password: 'appass' }),
        'start_ap',
        { ssid: 'MyAP', password: 'appass' },
      );
    });

    it('stopAp sends "stop_ap"', async () => {
      await assertCommandSent(() => protocol.stopAp(), 'stop_ap');
    });

    it('getVar sends "get_var" with key param', async () => {
      await assertCommandSent(
        () => protocol.getVar('firmware_version'),
        'get_var',
        { key: 'firmware_version' },
      );
    });

    it('setVar sends "set_var" with key and value params', async () => {
      await assertCommandSent(
        () => protocol.setVar('hostname', 'my-device'),
        'set_var',
        { key: 'hostname', value: 'my-device' },
      );
    });

    it('factoryReset sends "factory_reset"', async () => {
      await assertCommandSent(
        () => protocol.factoryReset(),
        'factory_reset',
      );
    });
  });

  // --------------------------------------------------------------------------
  // destroy()
  // --------------------------------------------------------------------------

  describe('destroy()', () => {
    it('abandons pending command on destroy (no unhandled rejection)', async () => {
      const promise = protocol.sendCommand('get_status');
      await jest.advanceTimersByTimeAsync(0);

      // Attach a catch handler so the abandoned promise doesn't trigger
      // unhandledRejection if it were to reject.
      let settled = false;
      promise.then(
        () => { settled = true; },
        () => { settled = true; },
      );

      protocol.destroy();
      await jest.advanceTimersByTimeAsync(0);

      // The promise should NOT have settled — it was abandoned, not rejected.
      expect(settled).toBe(false);
    });

    it('clears busy state on destroy', async () => {
      protocol.sendCommand('get_status');
      await jest.advanceTimersByTimeAsync(0);

      expect(protocol.isBusy).toBe(true);

      protocol.destroy();

      expect(protocol.isBusy).toBe(false);
    });

    it('does not throw when destroyed without a pending command', () => {
      expect(() => protocol.destroy()).not.toThrow();
    });

    it('stray response after destroy does not throw', async () => {
      protocol.sendCommand('get_status');
      await jest.advanceTimersByTimeAsync(0);

      protocol.destroy();

      // This should be a no-op because the listener was unsubscribed.
      expect(() =>
        transport.simulateResponse(
          JSON.stringify({ status: 'ok', data: {} }),
        ),
      ).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // writeCommand failure
  // --------------------------------------------------------------------------

  describe('writeCommand failure', () => {
    it('rejects when writeCommand rejects', async () => {
      jest.useRealTimers();
      transport.writeCommand.mockRejectedValueOnce(
        new Error('BLE write failed'),
      );

      const promise = protocol.sendCommand('get_status');

      await expect(promise).rejects.toThrow('BLE write failed');
    });
  });
});
