/**
 * Primary wizard hook. Returns every piece of provisioning state plus every
 * action verb needed to drive the flow.
 *
 * The shape mirrors `ProvisioningStoreState` + `ProvisioningStoreActions`
 * but is curated so consumers don't need to know about Zustand internals
 * or the underlying service classes.
 */

import { useProvisioningStore } from '../store/provisioningStore';
import { stepNumber as toStepNumber } from '../types/provisioning';

/**
 * Drives the provisioning wizard. Read `step` to know what to render and
 * call the matching action verb to advance.
 *
 * @example
 * const {
 *   step, device, error, scannedNetworks,
 *   start, chooseDevice, chooseNetwork, submitPassword, cancel,
 * } = useProvisioning();
 *
 * @see ProvisioningStep for the canonical step machine.
 * @see ProvisioningError for the error envelope shape.
 */
export function useProvisioning() {
  // -- Wizard --
  const step = useProvisioningStore((s) => s.step);
  const error = useProvisioningStore((s) => s.error);
  const lastResult = useProvisioningStore((s) => s.lastResult);
  const lastProvisionResult = useProvisioningStore((s) => s.lastProvisionResult);

  // -- Devices --
  const device = useProvisioningStore((s) => s.device);

  // -- WiFi --
  const scannedNetworks = useProvisioningStore((s) => s.scannedNetworks);
  const selectedNetwork = useProvisioningStore((s) => s.selectedNetwork);

  // -- Auth --
  const authMode = useProvisioningStore((s) => s.authMode);
  const defaultAuthValues = useProvisioningStore((s) => s.defaultAuthValues);
  const pendingAuth = useProvisioningStore((s) => s.pendingAuth);

  // -- Action verbs (see ProvisioningManager for canonical descriptions) --
  const start = useProvisioningStore((s) => s.start);
  const chooseDevice = useProvisioningStore((s) => s.chooseDevice);
  const proceedFromConfigure = useProvisioningStore((s) => s.proceedFromConfigure);
  const rescanWifi = useProvisioningStore((s) => s.rescanWifi);
  const chooseNetwork = useProvisioningStore((s) => s.chooseNetwork);
  const backToNetworks = useProvisioningStore((s) => s.backToNetworks);
  const submitPassword = useProvisioningStore((s) => s.submitPassword);
  const retryJoin = useProvisioningStore((s) => s.retryJoin);
  const pickDifferentNetwork = useProvisioningStore((s) => s.pickDifferentNetwork);
  const pickDifferentDevice = useProvisioningStore((s) => s.pickDifferentDevice);
  const cancel = useProvisioningStore((s) => s.cancel);
  const submitDeviceAuth = useProvisioningStore((s) => s.submitDeviceAuth);

  return {
    // -- State --
    step,
    /** 1-based user-visible numbered step, or `null` for non-numbered states. */
    stepNumber: toStepNumber(step),
    error,
    lastResult,
    lastProvisionResult,
    device,
    scannedNetworks,
    selectedNetwork,
    /** Which auth inputs the `enterDeviceAuth` screen should render. */
    authMode,
    /** Defaults from config to seed the auth screen. */
    defaultAuthValues,
    /** Last-submitted auth values (for pre-fill on unauthorized retry). */
    pendingAuth,

    // -- Actions --
    start,
    chooseDevice,
    proceedFromConfigure,
    rescanWifi,
    chooseNetwork,
    backToNetworks,
    submitPassword,
    retryJoin,
    pickDifferentNetwork,
    pickDifferentDevice,
    cancel,
    submitDeviceAuth,
  };
}
