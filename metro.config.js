const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// The website in `web/` and the CLI in `cli/` are not part of the app
// bundle, and their Rust build output (`target/`) runs to gigabytes; keep
// Metro from crawling them.
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  ...["web", "cli"].map((dir) => new RegExp(`^${escapeRegExp(path.join(__dirname, dir) + path.sep)}`)),
];

module.exports = config;
