function createAsyncStorageMock() {
  const mock = {
    __INTERNAL_MOCK_STORAGE__: {},
    getItem: jest.fn(async (key) => mock.__INTERNAL_MOCK_STORAGE__[key] ?? null),
    setItem: jest.fn(async (key, value) => {
      mock.__INTERNAL_MOCK_STORAGE__[key] = value;
    }),
    removeItem: jest.fn(async (key) => {
      delete mock.__INTERNAL_MOCK_STORAGE__[key];
    }),
    getMany: jest.fn(async (keys) =>
      Object.fromEntries(keys.map((key) => [key, mock.__INTERNAL_MOCK_STORAGE__[key] ?? null])),
    ),
    setMany: jest.fn(async (entries) => {
      Object.assign(mock.__INTERNAL_MOCK_STORAGE__, entries);
    }),
    removeMany: jest.fn(async (keys) => {
      for (const key of keys) delete mock.__INTERNAL_MOCK_STORAGE__[key];
    }),
    getAllKeys: jest.fn(async () => Object.keys(mock.__INTERNAL_MOCK_STORAGE__)),
    clear: jest.fn(async () => {
      for (const key of Object.keys(mock.__INTERNAL_MOCK_STORAGE__)) {
        delete mock.__INTERNAL_MOCK_STORAGE__[key];
      }
    }),
  };
  return mock;
}

module.exports = {
  __esModule: true,
  default: createAsyncStorageMock(),
  createAsyncStorage: jest.fn(() => createAsyncStorageMock()),
};
