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
