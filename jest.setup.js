// Global Jest setup shared across all test suites.

// Provide the official AsyncStorage mock so modules that import it (directly or
// transitively) don't crash with "NativeModule: AsyncStorage is null" under Jest.
jest.mock(
  "@react-native-async-storage/async-storage",
  () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// Mock NetInfo with its official mock. Without this, the real module registers a
// reachability poll on import that fires after the test env tears down and crashes Node.
jest.mock("@react-native-community/netinfo", () =>
  require("@react-native-community/netinfo/jest/netinfo-mock.js"),
);

// react-native's exports are lazy getters, and on a cold transform cache (every
// CI run) the first access to a UI module costs seconds: Animated ~2.3s,
// ScrollView/Pressable ~0.7s. Left to the first render, that cost lands inside
// whichever test mounts a screen first and has pushed several past Jest's 5s
// budget on CI. Touching them here charges it to setup, outside any test's
// timeout; once transformed, later files pay only module evaluation.
{
  const ReactNative = require("react-native");
  void [
    ReactNative.Animated,
    ReactNative.ScrollView,
    ReactNative.FlatList,
    ReactNative.Pressable,
    ReactNative.TouchableOpacity,
    ReactNative.ActivityIndicator,
    ReactNative.Modal,
    ReactNative.TextInput,
  ];
}
