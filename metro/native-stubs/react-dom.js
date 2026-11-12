function webOnly(name) {
  return () => {
    throw new Error(`react-dom ${name} is web-only and is not bundled into the native app`);
  };
}

module.exports = {
  version: require("react").version,
  createPortal: webOnly("createPortal"),
  flushSync: (callback) => callback(),
  createRoot: webOnly("createRoot"),
  hydrateRoot: webOnly("hydrateRoot"),
};
