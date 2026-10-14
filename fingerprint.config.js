const { SourceSkips } = require("expo/fingerprint");

// `runtimeVersion` in app.config.js is the fingerprint of the native project,
// so an OTA update only reaches binaries built from the same native code.
// The default sources cover packages, config plugins and the Expo config, but
// not the native sources our own plugins and targets copy into the build;
// hash those too, or a change to them would not block an incompatible OTA.
const nativeSource = (filePath, reason) => ({ type: "dir", filePath, reasons: [reason] });

/** @type {import('expo/fingerprint').Config} */
const config = {
  // The "balanced" preset's skips, plus package.json scripts and .gitignore:
  // neither reaches the binary, and hashing them would strand every OTA
  // published after an edit to a test or release script. Setting
  // `sourceSkips` replaces the preset's, so they are repeated here.
  sourceSkips:
    SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun |
    SourceSkips.ExpoConfigVersions |
    SourceSkips.ExpoConfigRuntimeVersionIfString |
    SourceSkips.EasJson |
    SourceSkips.Easignore |
    SourceSkips.AutolinkingConfigPaths |
    SourceSkips.PackageJsonScriptsAll |
    SourceSkips.GitIgnore,
  extraSources: [
    nativeSource("plugins/ios-app-intents", "iOS App Intents sources"),
    nativeSource("plugins/ios-saved-widget", "iOS saved-sessions widget bridge"),
    nativeSource("targets", "iOS widget extension"),
    nativeSource("widget", "Android widget sources"),
  ],
};

module.exports = config;
