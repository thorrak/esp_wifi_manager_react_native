const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Enable package.json "exports" field so subpath imports like
// 'esp-wifi-config-react-native/navigation' resolve correctly.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
