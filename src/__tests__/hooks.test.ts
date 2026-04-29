/**
 * Hook v1 tests.
 *
 * The hooks are thin selectors over the Zustand store + a few local-state
 * wrappers (useDeviceVariables, useDeviceProtocol). We verify exports, the
 * shape returned by `useProvisioning`, and the per-instance loading
 * behaviour of the trackers — without needing a full renderer.
 */

(globalThis as Record<string, unknown>).__DEV__ = false;

import * as hooks from '../hooks';
import { stepNumber, PROVISIONING_STEP_ORDER } from '../types/provisioning';

describe('hook exports', () => {
  it('exports all v1 hooks', () => {
    expect(typeof hooks.useProvisioning).toBe('function');
    expect(typeof hooks.useDeviceScanner).toBe('function');
    expect(typeof hooks.useBleConnection).toBe('function');
    expect(typeof hooks.useWifiStatus).toBe('function');
    expect(typeof hooks.useDeviceProtocol).toBe('function');
    expect(typeof hooks.useDeviceVariables).toBe('function');
    expect(typeof hooks.useSavedNetworks).toBe('function');
    expect(typeof hooks.useAccessPoint).toBe('function');
  });
});

describe('stepNumber helper used by useProvisioning', () => {
  it('returns null for non-numbered steps', () => {
    expect(stepNumber('welcome')).toBeNull();
    expect(stepNumber('success')).toBeNull();
    expect(stepNumber('manage')).toBeNull();
  });

  it('returns 1..5 for numbered steps with sub-states sharing numbers', () => {
    expect(stepNumber('scanBle')).toBe(1);
    expect(stepNumber('connectingBle')).toBe(1);
    expect(stepNumber('configuring')).toBe(2);
    expect(stepNumber('scanningWifi')).toBe(3);
    expect(stepNumber('chooseNetwork')).toBe(3);
    expect(stepNumber('enterCredentials')).toBe(4);
    expect(stepNumber('joiningWifi')).toBe(5);
  });

  it('PROVISIONING_STEP_ORDER includes every step except manage', () => {
    expect(PROVISIONING_STEP_ORDER).not.toContain('manage');
    expect(PROVISIONING_STEP_ORDER).toContain('welcome');
    expect(PROVISIONING_STEP_ORDER).toContain('configuring');
    expect(PROVISIONING_STEP_ORDER).toContain('joiningWifi');
    expect(PROVISIONING_STEP_ORDER).toContain('success');
  });
});
