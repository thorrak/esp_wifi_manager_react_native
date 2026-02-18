import { useProvisioningStore } from '../store/provisioningStore';

export function useDeviceProtocol() {
  const busy = useProvisioningStore((s) => s.busy);
  const lastCommandError = useProvisioningStore((s) => s.lastCommandError);

  const getStatus = useProvisioningStore((s) => s.getStatus);
  const scanNetworks = useProvisioningStore((s) => s.scanNetworks);
  const listNetworks = useProvisioningStore((s) => s.listNetworks);
  const addNetwork = useProvisioningStore((s) => s.addNetwork);
  const delNetwork = useProvisioningStore((s) => s.delNetwork);
  const connectWifi = useProvisioningStore((s) => s.connectWifi);
  const disconnectWifi = useProvisioningStore((s) => s.disconnectWifi);
  const getApStatus = useProvisioningStore((s) => s.getApStatus);
  const startAp = useProvisioningStore((s) => s.startAp);
  const stopAp = useProvisioningStore((s) => s.stopAp);
  const getVar = useProvisioningStore((s) => s.getVar);
  const setVar = useProvisioningStore((s) => s.setVar);
  const factoryReset = useProvisioningStore((s) => s.factoryReset);

  return {
    busy,
    lastCommandError,

    getStatus,
    scanNetworks,
    listNetworks,
    addNetwork,
    delNetwork,
    connectWifi,
    disconnectWifi,
    getApStatus,
    startAp,
    stopAp,
    getVar,
    setVar,
    factoryReset,
  };
}
