const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// The website in `web/` is not part of the app bundle, and its Rust build
// output (`web/target`) runs to gigabytes; keep Metro from crawling it.
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  new RegExp(`^${escapeRegExp(path.join(__dirname, "web") + path.sep)}`),
];

module.exports = config;
