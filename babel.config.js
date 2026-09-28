module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'babel-plugin-module-resolver',
        {
          // Same as tsconfig.json's paths: `@/assets/…` is the root assets/
          // folder, every other `@/…` is src/.
          alias: {
            '^@/assets/(.+)': './assets/\\1',
            '^@/(.+)': './src/\\1',
          },
        },
      ],
      'react-native-reanimated/plugin', // Must be last
    ],
  };
}; 
