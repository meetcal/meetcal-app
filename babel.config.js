module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'babel-plugin-module-resolver',
        {
          alias: {
            '@': '.',
          },
        },
      ],
      'react-native-reanimated/plugin', // Must be last
    ],
  };
}; 
