const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Gradle property `@react-native-async-storage/async-storage` reads for the
 * Android SQLite database ceiling (`android/config.gradle`, default 6 MB).
 */
const ASYNC_STORAGE_DB_SIZE_PROPERTY = 'AsyncStorage_db_size_in_MB';

/**
 * Android AsyncStorage size ceiling, in MB. The default is 6 MB, and every
 * write past it fails with `SQLITE_FULL`. A downloaded national meet is the
 * roster (~0.5 MB), its results, and the full competition history of ~1,500
 * athletes (~5 MB compressed); a season of downloads plus the browse caches
 * does not fit in 6. iOS has no such ceiling. 64 MB is a bound, not a
 * budget: history is pruned when a meet expires (`offline-store`) and on
 * `SQLITE_FULL` recovery (`meet-manager`).
 */
const ASYNC_STORAGE_DB_SIZE_MB = 64;

const withAsyncStorageDbSize = (config) =>
  withGradleProperties(config, (config) => {
    config.modResults = config.modResults.filter(
      (item) => !(item.type === 'property' && item.key === ASYNC_STORAGE_DB_SIZE_PROPERTY),
    );
    config.modResults.push({
      type: 'property',
      key: ASYNC_STORAGE_DB_SIZE_PROPERTY,
      value: String(ASYNC_STORAGE_DB_SIZE_MB),
    });
    return config;
  });

module.exports = withAsyncStorageDbSize;
module.exports.ASYNC_STORAGE_DB_SIZE_MB = ASYNC_STORAGE_DB_SIZE_MB;
module.exports.ASYNC_STORAGE_DB_SIZE_PROPERTY = ASYNC_STORAGE_DB_SIZE_PROPERTY;
