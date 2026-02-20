// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const react = require("eslint-plugin-react");
const reactNative = require("eslint-plugin-react-native");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "node_modules/*", ".expo/*"],
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    plugins: {
      react,
      "react-native": reactNative,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // Force JSX props onto multiple lines - max 2 props per line
      "react/jsx-max-props-per-line": [
        "error",
        {
          maximum: 3,
          when: "always",
        },
      ],

      // Force first prop onto new line for multi-prop components
      "react/jsx-first-prop-new-line": ["error", "multiline-multiprop"],

      // Force closing bracket onto new line for multiline JSX
      "react/jsx-closing-bracket-location": ["error", "line-aligned"],

      // Indent props properly
      "react/jsx-indent-props": ["error", 2],

      // One expression per line in JSX
      "react/jsx-one-expression-per-line": ["error", { allow: "single-child" }],

      // Disable React in scope rule (not needed in modern React)
      "react/react-in-jsx-scope": "off",

      // Disable prop-types (using TypeScript)
      "react/prop-types": "off",

      // React Native specific rules (from eslint-config-expo)
      "react-native/no-unused-styles": "error",
      // "react-native/no-inline-styles": "warn",
      "react-native/no-color-literals": "warn",
      "react-native/no-raw-text": "off", // Can be too strict
    },
  },
]);
