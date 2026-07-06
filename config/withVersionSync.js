const { withXcodeProject } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

// EAS remote version management (appVersionSource: "remote" + autoIncrement)
// only bumps the main app target's build number; extension targets
// (SavedWidget from @bacons/apple-targets, OneSignalNotificationServiceExtension)
// keep CURRENT_PROJECT_VERSION = 1, and App Store Connect requires an
// extension's CFBundleVersion to match its parent app.
// See https://github.com/expo/expo/issues/43740 — remove once fixed upstream.
//
// This mod runs during prebuild (after all targets are generated) and:
//  1. sets CURRENT_PROJECT_VERSION / MARKETING_VERSION on every app-project
//     target to the resolved ios.buildNumber / version, and
//  2. rewrites any hardcoded CFBundleVersion / CFBundleShortVersionString in
//     target Info.plists to the $(CURRENT_PROJECT_VERSION) / $(MARKETING_VERSION)
//     build-setting variables so they can't drift.
const withVersionSync = (config) => {
  return withXcodeProject(config, (config) => {
    const buildNumber = config.ios?.buildNumber ?? '1';
    const version = config.version ?? '1.0.0';
    const project = config.modResults;

    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const buildSettings = configurations[key].buildSettings;
      if (!buildSettings || buildSettings.PRODUCT_BUNDLE_IDENTIFIER === undefined) {
        continue;
      }
      buildSettings.CURRENT_PROJECT_VERSION = buildNumber;
      buildSettings.MARKETING_VERSION = version;

      const infoPlist = buildSettings.INFOPLIST_FILE;
      if (typeof infoPlist === 'string') {
        const plistPath = path.join(
          config.modRequest.platformProjectRoot,
          infoPlist.replace(/"/g, '')
        );
        if (fs.existsSync(plistPath)) {
          let contents = fs.readFileSync(plistPath, 'utf8');
          contents = contents
            .replace(
              /(<key>CFBundleVersion<\/key>\s*<string>)[^<]*(<\/string>)/,
              '$1$(CURRENT_PROJECT_VERSION)$2'
            )
            .replace(
              /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]*(<\/string>)/,
              '$1$(MARKETING_VERSION)$2'
            );
          fs.writeFileSync(plistPath, contents);
        }
      }
    }

    return config;
  });
};

module.exports = withVersionSync;
