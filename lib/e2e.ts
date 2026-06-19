export function isMaestroE2E() {
  return __DEV__ && process.env.EXPO_PUBLIC_MAESTRO_E2E === "1";
}
