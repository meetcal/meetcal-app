// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const react = require("eslint-plugin-react");
const reactNative = require("eslint-plugin-react-native");
const globals = require("globals");

module.exports = defineConfig([
  expoConfig,
  {
    // `coverage/` is Jest's generated lcov report (git-ignored build output).
    ignores: ["dist/*", "node_modules/*", ".expo/*", "coverage/*"],
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
      "react/jsx-one-expression-per-line": "off",

      // Disable React in scope rule (not needed in modern React)
      "react/react-in-jsx-scope": "off",

      // Disable prop-types (using TypeScript)
      "react/prop-types": "off",

      // React Native specific rules (from eslint-config-expo)
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
      "react-native/no-unused-styles": "error",
      // "react-native/no-inline-styles": "warn",
      "react-native/no-color-literals": "warn",
      "react-native/no-raw-text": "off", // Can be too strict
    },
  },
  {
    // CommonJS files that run under Node (Expo config plugins, build/tool
    // configs, the custom Jest environment): `require`, `module`, and
    // `__dirname` are real here.
    files: [
      "config/**/*.js",
      "jest/**/*.js",
      "targets/**/*.js",
      "*.config.js",
      ".prettierrc.js",
      "jest.setup.js",
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Jest setup and test files run with Jest's globals.
    files: ["jest.setup.js", "**/*.test.{js,jsx,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
  {
    // `require()` is the only way to load a module after
    // `jest.resetModules()` / `jest.isolateModules()` / `jest.doMock()`, and
    // inside a `jest.mock` factory (which cannot close over imports).
    files: ["**/*.test.{js,jsx,ts,tsx}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);
