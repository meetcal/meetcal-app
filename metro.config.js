const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Configure path aliases
config.resolver.alias = {
  '@': path.resolve(__dirname, '.'),
};

// Ensure we include the root directory in module resolution
config.resolver.platforms = ['ios', 'android', 'native', 'web'];

module.exports = config; 