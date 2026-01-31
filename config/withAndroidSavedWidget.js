const { withAndroidManifest, withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = path.join(__dirname, 'android-saved-widget');

const copyDir = (src, dest) => {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
};

const replacePackageName = (filePath, packageName) => {
  const contents = fs.readFileSync(filePath, 'utf8');
  const updated = contents.replace(/__PACKAGE_NAME__/g, packageName);
  if (contents !== updated) {
    fs.writeFileSync(filePath, updated);
  }
};

const withAndroidSavedWidget = config => {
  config = withDangerousMod(config, ['android', async config => {
    const projectRoot = config.modRequest.projectRoot;
    const packageName = config.android?.package;
    if (!packageName) {
      throw new Error('android.package is required to configure SavedWidget');
    }

    const androidMain = path.join(projectRoot, 'android', 'app', 'src', 'main');
    const packagePath = packageName.replace(/\./g, '/');

    const kotlinDest = path.join(androidMain, 'java', packagePath, 'widget');
    copyDir(path.join(TEMPLATE_DIR, 'java'), kotlinDest);

    // Replace package placeholders in Kotlin files
    for (const file of fs.readdirSync(kotlinDest)) {
      if (file.endsWith('.kt')) {
        replacePackageName(path.join(kotlinDest, file), packageName);
      }
    }

    const resDest = path.join(androidMain, 'res');
    copyDir(path.join(TEMPLATE_DIR, 'res'), resDest);

    return config;
  }]);

  config = withAndroidManifest(config, config => {
    const packageName = config.android?.package;
    if (!packageName) return config;

    const manifest = config.modResults.manifest;
    const application = manifest.application?.[0];
    if (!application) return config;

    application.receiver = application.receiver || [];

    const receiverName = `${packageName}.widget.SavedWidgetProvider`;
    const existing = application.receiver.find(r => r?.$?.['android:name'] === receiverName);
    if (!existing) {
      application.receiver.push({
        $: {
          'android:name': receiverName,
          'android:exported': 'true',
          'android:label': 'Saved Sessions'
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }
            ]
          }
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.appwidget.provider',
              'android:resource': '@xml/saved_widget_info'
            }
          }
        ]
      });
    }

    return config;
  });

  config = withMainApplication(config, config => {
    const packageName = config.android?.package;
    if (!packageName) return config;

    let contents = config.modResults.contents;
    if (!contents.includes('SavedWidgetPackage')) {
      const importStatement = `import ${packageName}.widget.SavedWidgetPackage`;
      if (!contents.includes(importStatement)) {
        contents = contents.replace(
          /import com\.facebook\.react\.PackageList\n/,
          match => `${match}${importStatement}\n`
        );
      }

      contents = contents.replace(
        /val packages = PackageList\(this\)\.packages\n/,
        match => `${match}    packages.add(SavedWidgetPackage())\n`
      );
    }

    config.modResults.contents = contents;
    return config;
  });

  return config;
};

module.exports = withAndroidSavedWidget;
