import { useEffect, useRef, useState, useCallback } from 'react';
import {
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  View,
  Text,
  TextInput,
  Platform,
} from 'react-native';
import {
  BleTransport,
  DeviceProtocol,
  DEVICE_NAME_PREFIX,
  DEFAULT_POP,
  requestBluetoothPermissions,
  type DiscoveredDevice,
  type ConnectedDeviceInfo,
  type DeviceVersionInfo,
  type DeviceCapabilities,
  type DeviceNetworkPolicy,
  type DeviceVariable,
  type ScannedNetwork,
} from 'esp-wifi-config-react-native';

type StepStatus = 'pending' | 'running' | 'pass' | 'fail';

interface LogEntry {
  time: string;
  message: string;
}

function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false,
    fractionalSecondDigits: 3,
  });
}

function StatusBadge({ status }: { status: StepStatus }) {
  const config = {
    pending: { label: 'PENDING', bg: '#8E8E93' },
    running: { label: 'RUNNING', bg: '#FF9500' },
    pass: { label: 'PASS', bg: '#34C759' },
    fail: { label: 'FAIL', bg: '#FF3B30' },
  }[status];

  return (
    <View style={[styles.badge, { backgroundColor: config.bg }]}>
      <Text style={styles.badgeText}>{config.label}</Text>
    </View>
  );
}

function LogView({ logs }: { logs: LogEntry[] }) {
  if (logs.length === 0) return null;
  return (
    <View style={styles.logContainer}>
      {logs.map((entry, i) => (
        <Text key={i} style={styles.logText}>
          <Text style={styles.logTime}>[{entry.time}]</Text> {entry.message}
        </Text>
      ))}
    </View>
  );
}

export default function DiagnosticsScreen() {
  const transportRef = useRef<BleTransport | null>(null);
  const protocolRef = useRef<DeviceProtocol | null>(null);

  // Step statuses
  const [permStatus, setPermStatus] = useState<StepStatus>('pending');
  const [scanStatus, setScanStatus] = useState<StepStatus>('pending');
  const [customScanStatus, setCustomScanStatus] = useState<StepStatus>('pending');
  const [connectStatus, setConnectStatus] = useState<StepStatus>('pending');
  const [versionStatus, setVersionStatus] = useState<StepStatus>('pending');
  const [capsStatus, setCapsStatus] = useState<StepStatus>('pending');
  const [policyStatus, setPolicyStatus] = useState<StepStatus>('pending');
  const [varsStatus, setVarsStatus] = useState<StepStatus>('pending');
  const [wifiScanStatus, setWifiScanStatus] = useState<StepStatus>('pending');

  // Step logs
  const [permLogs, setPermLogs] = useState<LogEntry[]>([]);
  const [scanLogs, setScanLogs] = useState<LogEntry[]>([]);
  const [customScanLogs, setCustomScanLogs] = useState<LogEntry[]>([]);
  const [connectLogs, setConnectLogs] = useState<LogEntry[]>([]);
  const [versionLogs, setVersionLogs] = useState<LogEntry[]>([]);
  const [capsLogs, setCapsLogs] = useState<LogEntry[]>([]);
  const [policyLogs, setPolicyLogs] = useState<LogEntry[]>([]);
  const [varsLogs, setVarsLogs] = useState<LogEntry[]>([]);
  const [wifiScanLogs, setWifiScanLogs] = useState<LogEntry[]>([]);

  // Data
  const [scannedDevices, setScannedDevices] = useState<DiscoveredDevice[]>([]);
  const [customScannedDevices, setCustomScannedDevices] = useState<DiscoveredDevice[]>([]);
  const [connectedInfo, setConnectedInfo] = useState<ConnectedDeviceInfo | null>(null);
  const [versionInfo, setVersionInfo] = useState<DeviceVersionInfo | null>(null);
  const [capsInfo, setCapsInfo] = useState<DeviceCapabilities | null>(null);
  const [policyInfo, setPolicyInfo] = useState<DeviceNetworkPolicy | null>(null);
  const [varsInfo, setVarsInfo] = useState<DeviceVariable[] | null>(null);
  const [wifiNetworks, setWifiNetworks] = useState<ScannedNetwork[] | null>(null);

  // User-editable inputs
  const [customPrefix, setCustomPrefix] = useState<string>('');
  const [pop, setPop] = useState<string>(DEFAULT_POP);

  // Section expansion
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    perm: true,
    scan: true,
    customScan: false,
    connect: true,
    version: false,
    caps: false,
    policy: false,
    vars: false,
    wifiScan: false,
  });
  const toggleSection = (key: string) =>
    setExpanded((e) => ({ ...e, [key]: !e[key] }));

  const addLog = useCallback(
    (setter: React.Dispatch<React.SetStateAction<LogEntry[]>>, message: string) => {
      setter((prev) => [...prev, { time: timestamp(), message }]);
    },
    []
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      protocolRef.current?.destroy();
      transportRef.current?.destroy();
      protocolRef.current = null;
      transportRef.current = null;
    };
  }, []);

  // ──────────────────────────────────────────────────────────────────────
  // Step 1 — Permissions
  // ──────────────────────────────────────────────────────────────────────
  const runPermissions = async () => {
    setPermStatus('running');
    setPermLogs([]);
    addLog(setPermLogs, 'Calling requestBluetoothPermissions()...');
    try {
      const result = await requestBluetoothPermissions();
      addLog(setPermLogs, `granted=${result.granted}`);
      if (!result.granted) addLog(setPermLogs, `reason: ${result.reason}`);
      setPermStatus(result.granted ? 'pass' : 'fail');
    } catch (e: unknown) {
      const err = e as Error;
      addLog(setPermLogs, `EXCEPTION: ${err.message}`);
      setPermStatus('fail');
    }
  };

  // ──────────────────────────────────────────────────────────────────────
  // Transport helpers
  // ──────────────────────────────────────────────────────────────────────
  const buildTransport = (
    setter: React.Dispatch<React.SetStateAction<LogEntry[]>>,
    prefix: string | undefined
  ): BleTransport => {
    // Tear down any previous transport before creating a new one — each
    // diagnostic scan uses its own prefix config.
    protocolRef.current?.destroy();
    protocolRef.current = null;
    if (transportRef.current) {
      transportRef.current.destroy();
      transportRef.current = null;
    }
    const transport = new BleTransport({
      deviceNamePrefix: prefix && prefix.length > 0 ? prefix : undefined,
      scanTimeoutMs: 10000,
      security: 1,
      proofOfPossession: pop,
    });
    transport.on('error', (err) => {
      addLog(setter, `ERROR EVENT: ${err.message}`);
    });
    transportRef.current = transport;
    return transport;
  };

  const runScanWith = async (
    prefix: string | undefined,
    setStatus: React.Dispatch<React.SetStateAction<StepStatus>>,
    setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>,
    setDevices: React.Dispatch<React.SetStateAction<DiscoveredDevice[]>>
  ) => {
    setStatus('running');
    setLogs([]);
    setDevices([]);
    addLog(setLogs, `Scanning with prefix "${prefix ?? DEVICE_NAME_PREFIX}" (10s)...`);
    try {
      const transport = buildTransport(setLogs, prefix);
      const discovered: DiscoveredDevice[] = [];
      const off1 = transport.on('deviceDiscovered', (d) => {
        discovered.push(d);
        setDevices([...discovered]);
        addLog(setLogs, `discovered: ${d.name} (${d.id}) rssi=${d.rssi ?? 'n/a'}`);
      });
      const off2 = transport.on('scanCompleted', (info) => {
        addLog(setLogs, `completed: matched=${info.matched} total=${info.total}`);
      });
      await transport.startScan();
      off1();
      off2();
      if (discovered.length === 0) {
        addLog(setLogs, 'No matching devices found.');
        setStatus('fail');
      } else {
        addLog(setLogs, `Done. ${discovered.length} device(s).`);
        setStatus('pass');
      }
    } catch (e: unknown) {
      const err = e as Error;
      addLog(setLogs, `EXCEPTION: ${err.message}`);
      setStatus('fail');
    }
  };

  const runDefaultScan = () =>
    runScanWith(undefined, setScanStatus, setScanLogs, setScannedDevices);
  const runCustomScan = () =>
    runScanWith(
      customPrefix,
      setCustomScanStatus,
      setCustomScanLogs,
      setCustomScannedDevices
    );

  // ──────────────────────────────────────────────────────────────────────
  // Step 4 — Connect
  // ──────────────────────────────────────────────────────────────────────
  const runConnect = async (device: DiscoveredDevice) => {
    setConnectStatus('running');
    setConnectLogs([]);
    setConnectedInfo(null);
    // Reset all downstream steps
    setVersionStatus('pending');
    setVersionLogs([]);
    setVersionInfo(null);
    setCapsStatus('pending');
    setCapsLogs([]);
    setCapsInfo(null);
    setPolicyStatus('pending');
    setPolicyLogs([]);
    setPolicyInfo(null);
    setVarsStatus('pending');
    setVarsLogs([]);
    setVarsInfo(null);
    setWifiScanStatus('pending');
    setWifiScanLogs([]);
    setWifiNetworks(null);

    addLog(setConnectLogs, `Connecting to ${device.name} (${device.id}) with PoP "${pop}"...`);
    try {
      const transport = transportRef.current;
      if (!transport) {
        addLog(setConnectLogs, 'No transport — run a scan first.');
        setConnectStatus('fail');
        return;
      }
      const info = await transport.connect(device.id, { pop });
      addLog(setConnectLogs, `Connected. mtu=${info.mtu ?? 'n/a'}`);
      setConnectedInfo(info);
      protocolRef.current = new DeviceProtocol(transport);
      setConnectStatus('pass');
    } catch (e: unknown) {
      const err = e as Error;
      addLog(setConnectLogs, `EXCEPTION: ${err.message}`);
      setConnectStatus('fail');
    }
  };

  // ──────────────────────────────────────────────────────────────────────
  // Generic protocomm step runner
  // ──────────────────────────────────────────────────────────────────────
  const runProtocolStep = async <T,>(
    label: string,
    op: (p: DeviceProtocol) => Promise<T>,
    setStatus: React.Dispatch<React.SetStateAction<StepStatus>>,
    setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>,
    setData: (v: T) => void,
    summarize: (v: T) => string
  ) => {
    setStatus('running');
    setLogs([]);
    addLog(setLogs, `${label}...`);
    try {
      const protocol = protocolRef.current;
      if (!protocol) {
        addLog(setLogs, 'Not connected — connect to a device first.');
        setStatus('fail');
        return;
      }
      const result = await op(protocol);
      setData(result);
      addLog(setLogs, summarize(result));
      setStatus('pass');
    } catch (e: unknown) {
      const err = e as Error;
      addLog(setLogs, `EXCEPTION: ${err.message}`);
      setStatus('fail');
    }
  };

  const runVersion = () =>
    runProtocolStep(
      'getVersion()',
      (p) => p.getVersion(),
      setVersionStatus,
      setVersionLogs,
      setVersionInfo,
      (v) =>
        `OK. ${Object.entries(v)
          .filter(([, val]) => val != null)
          .map(([k, val]) => `${k}=${val}`)
          .join(', ')}`
    );

  const runCapabilities = () =>
    runProtocolStep(
      'getCapabilities()',
      (p) => p.getCapabilities(),
      setCapsStatus,
      setCapsLogs,
      setCapsInfo,
      (c) =>
        `OK. capabilities=[${c.capabilities.join(', ')}] max_networks=${c.max_networks ?? '?'} max_vars=${c.max_vars ?? '?'}`
    );

  const runNetworkPolicy = () =>
    runProtocolStep(
      'getNetworkPolicy()',
      (p) => p.getNetworkPolicy(),
      setPolicyStatus,
      setPolicyLogs,
      setPolicyInfo,
      (p) =>
        `OK. ${Object.entries(p)
          .filter(([, val]) => val != null)
          .map(([k, val]) => `${k}=${val}`)
          .join(', ')}`
    );

  const runListVars = () =>
    runProtocolStep(
      'listVars()',
      (p) => p.listVars(),
      setVarsStatus,
      setVarsLogs,
      setVarsInfo,
      (vars) =>
        vars.length === 0
          ? 'OK. No variables set.'
          : `OK. ${vars.length} variable(s): ${vars.map((v) => v.key).join(', ')}`
    );

  const runWifiScan = () =>
    runProtocolStep(
      'scanWifi()',
      (p) => p.scanWifi(),
      setWifiScanStatus,
      setWifiScanLogs,
      setWifiNetworks,
      (networks) =>
        networks.length === 0
          ? 'OK. No WiFi networks found.'
          : `OK. ${networks.length} network(s). First 5: ${networks
              .slice(0, 5)
              .map((n) => `${n.ssid}(${n.rssi})`)
              .join(', ')}`
    );

  // ──────────────────────────────────────────────────────────────────────
  // Disconnect
  // ──────────────────────────────────────────────────────────────────────
  const runDisconnect = async () => {
    try {
      await transportRef.current?.disconnect();
      addLog(setConnectLogs, 'Disconnected.');
    } catch (e: unknown) {
      const err = e as Error;
      addLog(setConnectLogs, `Disconnect error: ${err.message}`);
    }
    protocolRef.current?.destroy();
    protocolRef.current = null;
    setConnectedInfo(null);
    setConnectStatus('pending');
  };

  // ──────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────
  const renderDeviceList = (
    list: DiscoveredDevice[],
    onTap?: (d: DiscoveredDevice) => void
  ) => {
    if (list.length === 0) return null;
    return (
      <View style={styles.deviceList}>
        {list.map((d) => (
          <TouchableOpacity
            key={d.id}
            style={styles.deviceItem}
            onPress={() => onTap?.(d)}
            disabled={!onTap}
          >
            <Text style={styles.deviceName}>{d.name || '(unnamed)'}</Text>
            <Text style={styles.deviceDetail}>
              {d.id} | RSSI: {d.rssi ?? 'N/A'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.title}>Diagnostics</Text>
      <Text style={styles.subtitle}>
        Exercises BleTransport / DeviceProtocol against esp_wifi_config 0.1.0+
      </Text>

      {/* Step 1: Permissions */}
      <View style={styles.card}>
        <TouchableOpacity style={styles.cardHeader} onPress={() => toggleSection('perm')}>
          <Text style={styles.stepLabel}>1. Bluetooth Permissions</Text>
          <StatusBadge status={permStatus} />
        </TouchableOpacity>
        {expanded.perm && (
          <View style={styles.cardBody}>
            <TouchableOpacity style={styles.actionButton} onPress={runPermissions}>
              <Text style={styles.actionButtonText}>Request Permissions</Text>
            </TouchableOpacity>
            <LogView logs={permLogs} />
          </View>
        )}
      </View>

      {/* Step 2: Default scan */}
      <View style={styles.card}>
        <TouchableOpacity style={styles.cardHeader} onPress={() => toggleSection('scan')}>
          <Text style={styles.stepLabel}>2. Scan (default `{DEVICE_NAME_PREFIX}`)</Text>
          <StatusBadge status={scanStatus} />
        </TouchableOpacity>
        {expanded.scan && (
          <View style={styles.cardBody}>
            <Text style={styles.hint}>
              Scans for devices matching {DEVICE_NAME_PREFIX}* (10s).
            </Text>
            <TouchableOpacity
              style={[styles.actionButton, scanStatus === 'running' && styles.disabledButton]}
              onPress={runDefaultScan}
              disabled={scanStatus === 'running'}
            >
              <Text style={styles.actionButtonText}>
                {scanStatus === 'running' ? 'Scanning…' : 'Start Scan'}
              </Text>
            </TouchableOpacity>
            {renderDeviceList(scannedDevices, runConnect)}
            <LogView logs={scanLogs} />
          </View>
        )}
      </View>

      {/* Step 3: Custom prefix scan */}
      <View style={styles.card}>
        <TouchableOpacity style={styles.cardHeader} onPress={() => toggleSection('customScan')}>
          <Text style={styles.stepLabel}>3. Scan (custom prefix)</Text>
          <StatusBadge status={customScanStatus} />
        </TouchableOpacity>
        {expanded.customScan && (
          <View style={styles.cardBody}>
            <Text style={styles.hint}>
              Filter by your own name prefix. Leave blank to use the library default.
            </Text>
            <TextInput
              style={styles.input}
              value={customPrefix}
              onChangeText={setCustomPrefix}
              placeholder={DEVICE_NAME_PREFIX}
              placeholderTextColor="#48484A"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.actionButton, customScanStatus === 'running' && styles.disabledButton]}
              onPress={runCustomScan}
              disabled={customScanStatus === 'running'}
            >
              <Text style={styles.actionButtonText}>
                {customScanStatus === 'running' ? 'Scanning…' : 'Start Scan'}
              </Text>
            </TouchableOpacity>
            {renderDeviceList(customScannedDevices, runConnect)}
            <LogView logs={customScanLogs} />
          </View>
        )}
      </View>

      {/* Step 4: Connect */}
      <View style={styles.card}>
        <TouchableOpacity style={styles.cardHeader} onPress={() => toggleSection('connect')}>
          <Text style={styles.stepLabel}>4. Connect (protocomm session)</Text>
          <StatusBadge status={connectStatus} />
        </TouchableOpacity>
        {expanded.connect && (
          <View style={styles.cardBody}>
            <Text style={styles.hint}>Proof of Possession (Security 1):</Text>
            <TextInput
              style={styles.input}
              value={pop}
              onChangeText={setPop}
              placeholder={DEFAULT_POP}
              placeholderTextColor="#48484A"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={false}
            />
            <Text style={styles.hint}>
              Tap a device above to connect. Session-init negotiates PoP via the SDK.
            </Text>
            {connectedInfo && (
              <Text style={styles.stateText}>
                Connected: {connectedInfo.name} ({connectedInfo.id})
              </Text>
            )}
            <LogView logs={connectLogs} />
          </View>
        )}
      </View>

      {/* Step 5: getVersion */}
      <View style={styles.card}>
        <TouchableOpacity style={styles.cardHeader} onPress={() => toggleSection('version')}>
          <Text style={styles.stepLabel}>5. getVersion()</Text>
          <StatusBadge status={versionStatus} />
        </TouchableOpacity>
        {expanded.version && (
          <View style={styles.cardBody}>
            <TouchableOpacity
              style={[styles.actionButton, connectStatus !== 'pass' && styles.disabledButton]}
              onPress={runVersion}
              disabled={connectStatus !== 'pass'}
            >
              <Text style={styles.actionButtonText}>Fetch Version</Text>
            </TouchableOpacity>
            {versionInfo && (
              <Text style={styles.kvBlock}>{JSON.stringify(versionInfo, null, 2)}</Text>
            )}
            <LogView logs={versionLogs} />
          </View>
        )}
      </View>

      {/* Step 6: getCapabilities */}
      <View style={styles.card}>
        <TouchableOpacity style={styles.cardHeader} onPress={() => toggleSection('caps')}>
          <Text style={styles.stepLabel}>6. getCapabilities()</Text>
          <StatusBadge status={capsStatus} />
        </TouchableOpacity>
        {expanded.caps && (
          <View style={styles.cardBody}>
            <TouchableOpacity
              style={[styles.actionButton, connectStatus !== 'pass' && styles.disabledButton]}
              onPress={runCapabilities}
              disabled={connectStatus !== 'pass'}
            >
              <Text style={styles.actionButtonText}>Fetch Capabilities</Text>
            </TouchableOpacity>
            {capsInfo && (
              <Text style={styles.kvBlock}>{JSON.stringify(capsInfo, null, 2)}</Text>
            )}
            <LogView logs={capsLogs} />
          </View>
        )}
      </View>

      {/* Step 7: getNetworkPolicy */}
      <View style={styles.card}>
        <TouchableOpacity style={styles.cardHeader} onPress={() => toggleSection('policy')}>
          <Text style={styles.stepLabel}>7. getNetworkPolicy()</Text>
          <StatusBadge status={policyStatus} />
        </TouchableOpacity>
        {expanded.policy && (
          <View style={styles.cardBody}>
            <TouchableOpacity
              style={[styles.actionButton, connectStatus !== 'pass' && styles.disabledButton]}
              onPress={runNetworkPolicy}
              disabled={connectStatus !== 'pass'}
            >
              <Text style={styles.actionButtonText}>Fetch Policy</Text>
            </TouchableOpacity>
            {policyInfo && (
              <Text style={styles.kvBlock}>{JSON.stringify(policyInfo, null, 2)}</Text>
            )}
            <LogView logs={policyLogs} />
          </View>
        )}
      </View>

      {/* Step 8: listVars */}
      <View style={styles.card}>
        <TouchableOpacity style={styles.cardHeader} onPress={() => toggleSection('vars')}>
          <Text style={styles.stepLabel}>8. listVars()</Text>
          <StatusBadge status={varsStatus} />
        </TouchableOpacity>
        {expanded.vars && (
          <View style={styles.cardBody}>
            <TouchableOpacity
              style={[styles.actionButton, connectStatus !== 'pass' && styles.disabledButton]}
              onPress={runListVars}
              disabled={connectStatus !== 'pass'}
            >
              <Text style={styles.actionButtonText}>List Variables</Text>
            </TouchableOpacity>
            {varsInfo && varsInfo.length > 0 && (
              <View style={styles.kvBlockContainer}>
                {varsInfo.map((v) => (
                  <Text key={v.key} style={styles.kvLine}>
                    <Text style={styles.kvKey}>{v.key}</Text> = {v.value}
                  </Text>
                ))}
              </View>
            )}
            <LogView logs={varsLogs} />
          </View>
        )}
      </View>

      {/* Step 9: scanWifi */}
      <View style={styles.card}>
        <TouchableOpacity style={styles.cardHeader} onPress={() => toggleSection('wifiScan')}>
          <Text style={styles.stepLabel}>9. scanWifi()</Text>
          <StatusBadge status={wifiScanStatus} />
        </TouchableOpacity>
        {expanded.wifiScan && (
          <View style={styles.cardBody}>
            <TouchableOpacity
              style={[styles.actionButton, connectStatus !== 'pass' && styles.disabledButton]}
              onPress={runWifiScan}
              disabled={connectStatus !== 'pass'}
            >
              <Text style={styles.actionButtonText}>Scan WiFi (via device)</Text>
            </TouchableOpacity>
            {wifiNetworks && wifiNetworks.length > 0 && (
              <View style={styles.kvBlockContainer}>
                {wifiNetworks.slice(0, 15).map((n, i) => (
                  <Text key={`${n.ssid}-${i}`} style={styles.kvLine}>
                    {n.ssid}{' '}
                    <Text style={styles.kvKey}>
                      ({n.rssi} dBm, {n.auth})
                    </Text>
                  </Text>
                ))}
              </View>
            )}
            <LogView logs={wifiScanLogs} />
          </View>
        )}
      </View>

      {/* Disconnect */}
      {connectStatus === 'pass' && (
        <TouchableOpacity
          style={[styles.actionButton, styles.disconnectButton]}
          onPress={runDisconnect}
        >
          <Text style={styles.actionButtonText}>Disconnect</Text>
        </TouchableOpacity>
      )}

      <View style={{ height: 60 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  contentContainer: {
    padding: 16,
    paddingTop: Platform.OS === 'ios' ? 60 : 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#8E8E93',
    marginBottom: 20,
  },
  card: {
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
  },
  cardBody: {
    padding: 14,
    paddingTop: 0,
    gap: 10,
  },
  stepLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFF',
    flex: 1,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFF',
  },
  actionButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  actionButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  disabledButton: {
    backgroundColor: '#3A3A3C',
  },
  disconnectButton: {
    backgroundColor: '#FF3B30',
    alignSelf: 'center',
    marginTop: 8,
  },
  hint: {
    fontSize: 12,
    color: '#8E8E93',
  },
  stateText: {
    fontSize: 14,
    color: '#FFF',
    fontWeight: '500',
  },
  input: {
    backgroundColor: '#2C2C2E',
    color: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  logContainer: {
    backgroundColor: '#000',
    borderRadius: 8,
    padding: 10,
  },
  logText: {
    fontSize: 11,
    color: '#30D158',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  logTime: {
    color: '#8E8E93',
  },
  deviceList: {
    gap: 6,
  },
  deviceItem: {
    backgroundColor: '#2C2C2E',
    padding: 10,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#34C759',
  },
  deviceName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFF',
  },
  deviceDetail: {
    fontSize: 11,
    color: '#8E8E93',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },
  kvBlock: {
    backgroundColor: '#000',
    color: '#FFF',
    fontSize: 11,
    padding: 10,
    borderRadius: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  kvBlockContainer: {
    backgroundColor: '#000',
    padding: 10,
    borderRadius: 8,
    gap: 4,
  },
  kvLine: {
    fontSize: 12,
    color: '#FFF',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  kvKey: {
    color: '#8E8E93',
  },
});
