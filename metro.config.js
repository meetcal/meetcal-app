const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Configure path aliases
config.resolver.alias = {
  '@': __dirname,
};

module.exports = config; 