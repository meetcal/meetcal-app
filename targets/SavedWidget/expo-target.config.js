module.exports = {
  type: 'widget',
  name: 'SavedWidget',
  displayName: 'Saved Sessions',
  bundleIdentifier: '.SavedWidget',
  deploymentTarget: '18.0',
  frameworks: ['SwiftUI', 'WidgetKit'],
  entitlements: {
    'com.apple.security.application-groups': ['group.com.memohnsen.meetcal']
  }
};
