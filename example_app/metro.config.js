// Metro config for the example app, which consumes the library one directory up
// via a `file:..` dependency (node_modules/esp-wifi-config-react-native → ../..).
//
// The library lives ABOVE this app's project root and has its OWN node_modules
// (dev-dependency copies of react / react-native, etc.). Two problems follow,
// each with a targeted fix:
//
//   1. Metro won't serve files outside the project root → add the repo root to
//      watchFolders. (Also lets the `/navigation` subpath export resolve.)
//   2. A bare `react` / `react-native` imported from the library's built output
//      would resolve to the library's copies at the repo root, giving two Reacts
//      and invalid-hook-call errors. Force just those shared singletons to THIS
//      app's node_modules. Everything else (the library's own `zustand`, Expo's
//      nested deps) keeps normal hierarchical resolution.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');
const appModules = path.resolve(projectRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [repoRoot];
config.resolver.unstable_enablePackageExports = true;

// Packages that must be a single instance shared between the app and the
// linked library. Redirect these (and their subpaths) to the app's copy.
const FORCE_APP_COPY = [
  'react',
  'react-dom',
  'react-native',
  'react-native-safe-area-context',
  'react-native-screens',
  '@react-navigation/native',
  '@react-navigation/native-stack',
  '@react-navigation/elements',
  // core + routers carry the context that NavigationIndependentTree uses; if
  // the library and app resolve different copies, ProvisioningNavigator's
  // nested container errors with "nested a NavigationContainer".
  '@react-navigation/core',
  '@react-navigation/routers',
];

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const forced = FORCE_APP_COPY.find(
    (name) => moduleName === name || moduleName.startsWith(name + '/'),
  );
  if (forced) {
    const rest = moduleName.slice(forced.length); // '' or '/subpath'
    return context.resolveRequest(
      context,
      path.join(appModules, forced) + rest,
      platform,
    );
  }
  return (defaultResolveRequest ?? context.resolveRequest)(
    context,
    moduleName,
    platform,
  );
};

module.exports = config;
