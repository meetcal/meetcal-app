const { withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const {
  Paths,
  XcodeUtils,
} = require('@expo/config-plugins/build/ios');

const TEMPLATE_DIR = path.join(__dirname, 'ios-saved-widget');
const FILES = ['SavedWidgetModule.m'];

const withIOSSavedWidget = (config) => {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const sourceRoot = Paths.getSourceRoot(projectRoot);
      const projectName = path.basename(sourceRoot);

      for (const file of FILES) {
        const src = path.join(TEMPLATE_DIR, file);
        const dest = path.join(sourceRoot, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }

      const projectPath = Paths.getPBXProjectPath(projectRoot);
      const project = XcodeUtils.getPbxproj(projectRoot);

      XcodeUtils.addBuildSourceFileToGroup({
        filepath: `${projectName}/SavedWidgetModule.m`,
        groupName: projectName,
        project,
      });

      const productName = XcodeUtils.getProductName(project);
      XcodeUtils.addFramework({
        project,
        projectName: productName,
        framework: 'WidgetKit.framework',
      });

      fs.writeFileSync(projectPath, project.writeSync());

      return config;
    },
  ]);
};

module.exports = withIOSSavedWidget;
