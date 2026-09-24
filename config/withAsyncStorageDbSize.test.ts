type GradleConfig = { modResults: unknown[] };
type GradleMod = (config: GradleConfig) => GradleConfig;

const mockWithGradleProperties = jest.fn((config: unknown, mod: GradleMod) =>
  mod({ ...(config as object), modResults: [] }),
);

jest.mock("@expo/config-plugins", () => ({
  withGradleProperties: (config: unknown, mod: unknown) =>
    mockWithGradleProperties(config, mod as GradleMod),
}));

const withAsyncStorageDbSize = require("@/config/withAsyncStorageDbSize");

describe("withAsyncStorageDbSize", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("raises the Android AsyncStorage ceiling above the 6 MB default via gradle.properties", () => {
    const result = withAsyncStorageDbSize({ name: "MeetCal" });

    expect(mockWithGradleProperties).toHaveBeenCalledTimes(1);
    expect(result.modResults).toEqual([
      { type: "property", key: "AsyncStorage_db_size_in_MB", value: "64" },
    ]);
    expect(withAsyncStorageDbSize.ASYNC_STORAGE_DB_SIZE_MB).toBeGreaterThan(6);
  });

  it("replaces an existing property instead of adding a duplicate", () => {
    mockWithGradleProperties.mockImplementationOnce((config, mod) =>
      mod({
        ...(config as object),
        modResults: [
          { type: "property", key: "AsyncStorage_db_size_in_MB", value: "6" },
          { type: "property", key: "org.gradle.jvmargs", value: "-Xmx2g" },
        ],
      }),
    );

    const result = withAsyncStorageDbSize({ name: "MeetCal" });

    expect(result.modResults).toEqual([
      { type: "property", key: "org.gradle.jvmargs", value: "-Xmx2g" },
      { type: "property", key: "AsyncStorage_db_size_in_MB", value: "64" },
    ]);
  });
});
