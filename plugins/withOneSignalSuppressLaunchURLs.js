const { AndroidConfig, withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');

/**
 * Tells the OneSignal SDK not to open a push's launch URL itself when the
 * push is tapped. The app's own click listener (`src/app/_layout.tsx`) opens
 * it: an in-app path through the router, anything else in the browser. With
 * OneSignal's default both did, so a `meetcal:///...` push stacked the screen
 * twice and an `https://` one opened the page twice (#288).
 *
 * iOS reads the Info.plist key (present in the OneSignal iOS SDK the app
 * builds against); Android reads the application meta-data.
 */
const IOS_SUPPRESS_LAUNCH_URLS_KEY = 'OneSignal_suppress_launch_urls';
const ANDROID_SUPPRESS_LAUNCH_URLS_KEY = 'com.onesignal.suppressLaunchURLs';

function setSuppressLaunchURLsInfoPlist(infoPlist) {
  return { ...infoPlist, [IOS_SUPPRESS_LAUNCH_URLS_KEY]: true };
}

function setSuppressLaunchURLsManifest(androidManifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(
    application,
    ANDROID_SUPPRESS_LAUNCH_URLS_KEY,
    'true',
  );
  return androidManifest;
}

const withOneSignalSuppressLaunchURLs = (config) => {
  config = withInfoPlist(config, (config) => {
    config.modResults = setSuppressLaunchURLsInfoPlist(config.modResults);
    return config;
  });
  return withAndroidManifest(config, (config) => {
    config.modResults = setSuppressLaunchURLsManifest(config.modResults);
    return config;
  });
};

module.exports = withOneSignalSuppressLaunchURLs;
module.exports.IOS_SUPPRESS_LAUNCH_URLS_KEY = IOS_SUPPRESS_LAUNCH_URLS_KEY;
module.exports.ANDROID_SUPPRESS_LAUNCH_URLS_KEY = ANDROID_SUPPRESS_LAUNCH_URLS_KEY;
module.exports.setSuppressLaunchURLsInfoPlist = setSuppressLaunchURLsInfoPlist;
module.exports.setSuppressLaunchURLsManifest = setSuppressLaunchURLsManifest;
