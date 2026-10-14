// `runtimeVersion` in app.config.js is the fingerprint of the native project,
// so an OTA update only reaches binaries built from the same native code.
// The default sources cover packages, config plugins and the Expo config, but
// not the native sources our own plugins and targets copy into the build;
// hash those too, or a change to them would not block an incompatible OTA.
const nativeSource = (filePath, reason) => ({ type: "dir", filePath, reasons: [reason] });

/** @type {import('expo/fingerprint').Config} */
const config = {
  extraSources: [
    nativeSource("plugins/ios-app-intents", "iOS App Intents sources"),
    nativeSource("plugins/ios-saved-widget", "iOS saved-sessions widget bridge"),
    nativeSource("targets", "iOS widget extension"),
    nativeSource("widget", "Android widget sources"),
  ],
};

module.exports = config;
