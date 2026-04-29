/**
 * examples/minimal-app.tsx — drop-in WiFi provisioning screen with zero UI work.
 *
 * Place at app/provision.tsx (Expo Router) or wherever your navigation routes.
 */

import { ProvisioningNavigator } from 'esp-wifi-config-react-native/navigation';
import { router } from 'expo-router';

export default function ProvisionScreen() {
  return (
    <ProvisioningNavigator
      config={{
        ble: { deviceNamePrefix: ['ESP32-WiFi-', 'MyDevice-'] },
      }}
      onComplete={(result) => {
        console.log('Provisioned!', {
          ssid: result.ssid,
          ip: result.ip,
          deviceId: result.deviceId,
          deviceName: result.deviceName,
        });
        router.back();
      }}
      onDismiss={() => router.back()}
      theme={{
        colors: {
          primary: '#2563EB',
          background: '#F8FAFC',
          card: '#FFFFFF',
        },
        borderRadius: 12,
      }}
    />
  );
}
