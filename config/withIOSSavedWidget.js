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
      
      // Add WidgetKit framework with weak linking (optional)
      const frameworkOptions = {
        project,
        projectName: productName,
        framework: 'WidgetKit.framework',
      };
      
      // Add the framework
      XcodeUtils.addFramework(frameworkOptions);
      
      // Make it optional (weak linking) by finding and modifying the framework reference
      const frameworks = project.pbxFrameworksBuildPhaseObj(project.getFirstTarget().uuid);
      if (frameworks && frameworks.files) {
        for (const file of frameworks.files) {
          const fileRef = project.pbxFileReferenceSection()[file.value];
          if (fileRef && fileRef.path === 'WidgetKit.framework') {
            // Mark as optional/weak
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

module.exports = withIOSSavedWidget;
