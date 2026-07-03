const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const {
  Paths,
  XcodeUtils,
} = require('@expo/config-plugins/build/ios');

const TEMPLATE_DIR = path.join(__dirname, 'ios-app-intents');

// Swift App Intents sources + the React Native bridge (Obj-C + Swift).
// All compiled into the MAIN app target so AppShortcutsProvider is discovered
// and intents can share the App Group + make network calls.
const FILES = [
  'SharedStore.swift',
  'MeetCalAPI.swift',
  'Entities.swift',
  'Queries.swift',
  'Intents.swift',
  'SnippetViews.swift',
  'AppShortcuts.swift',
  'SemanticIndex.swift',
  'AppIntentsBridge.swift',
  'AppIntentsBridge.m',
];

const withIOSAppIntents = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const sourceRoot = Paths.getSourceRoot(projectRoot);
      const projectName = path.basename(sourceRoot);

      for (const file of FILES) {
        const src = path.join(TEMPLATE_DIR, file);
        const dest = path.join(sourceRoot, file);
        if (!fs.existsSync(src)) {
          throw new Error(
            `App Intents template not found: ${file}. Expected at ${src}`,
          );
        }
        fs.copyFileSync(src, dest);
      }

      const projectPath = Paths.getPBXProjectPath(projectRoot);
      const project = XcodeUtils.getPbxproj(projectRoot);

      for (const file of FILES) {
        XcodeUtils.addBuildSourceFileToGroup({
          filepath: `${projectName}/${file}`,
          groupName: projectName,
          project,
        });
      }

      const productName = XcodeUtils.getProductName(project);

      // CoreSpotlight is used (weakly) by the iOS 27 semantic-index donation
      // code. Weak-link it so the app still loads on older systems / when the
      // framework symbols differ.
      XcodeUtils.addFramework({
        project,
        projectName: productName,
        framework: 'CoreSpotlight.framework',
      });

      const firstTarget = project.getFirstTarget();
      if (!firstTarget) {
        throw new Error('withIOSAppIntents: no target found in Xcode project');
      }

      const frameworks = project.pbxFrameworksBuildPhaseObj(firstTarget.uuid);
      if (frameworks && frameworks.files) {
        const buildFileSection = project.pbxBuildFileSection();
        const fileRefSection = project.pbxFileReferenceSection();
        for (const file of frameworks.files) {
          const buildFile = buildFileSection[file.value];
          if (!buildFile || !buildFile.fileRef) continue;
          const fileRef = fileRefSection[buildFile.fileRef];
          if (!fileRef || !fileRef.path) continue;
          const pathStr =
            typeof fileRef.path === 'string'
              ? fileRef.path
              : String(fileRef.path);
          if (
            pathStr.endsWith('CoreSpotlight.framework') ||
            pathStr.includes('/CoreSpotlight.framework')
          ) {
            if (!file.settings) {
              file.settings = {};
            }
            file.settings.ATTRIBUTES = ['Weak'];
            break;
          }
        }
      }

      fs.writeFileSync(projectPath, project.writeSync());

      return config;
    },
  ]);
};

module.exports = withIOSAppIntents;
