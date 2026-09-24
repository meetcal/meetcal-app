/**
 * Jest environment that pins the *device* time zone for each test file.
 *
 * Assigning `process.env.TZ` inside a test does nothing: the test sandbox
 * gets a copy of `process.env`, so Node's TZ setter (which resets V8's and
 * ICU's zone cache) never runs and `Date` keeps the runner's zone. This
 * environment assigns the real `process.env.TZ` in the worker before the
 * file's code loads, so `new Date("January 15, 2026")`, `getDate()` and
 * `Intl.DateTimeFormat()` with no `timeZone` all read the pinned zone.
 *
 * Default: Pacific/Auckland (UTC+12/+13), so a device-local midnight read
 * back in UTC lands on the previous day. A file that needs a US device zone
 * (UTC midnight read back as local lands on the previous day) opts in with a
 * docblock at the top of the file:
 *
 *   /**
 *    * @jest-environment-options {"deviceTimeZone": "America/Los_Angeles"}
 *    *\/
 *
 * `JEST_DEVICE_TIME_ZONE=America/Chicago bunx jest --ci` sweeps the files
 * without a docblock through another zone (a docblock still wins).
 *
 * Every file sets the zone, so a worker never leaks one file's zone into
 * the next.
 */
'use strict';

const ReactNativeEnv = require('@react-native/jest-preset/jest/react-native-env.js');

const DEFAULT_DEVICE_TIME_ZONE = 'Pacific/Auckland';

function assertTimeZone(zone) {
  if (typeof zone !== 'string' || zone.trim() === '') {
    throw new Error(`deviceTimeZone must be a non-empty IANA zone, got ${String(zone)}`);
  }
  // Throws RangeError for an unknown identifier.
  new Intl.DateTimeFormat('en-US', { timeZone: zone });
  return zone;
}

module.exports = class DeviceTimeZoneEnvironment extends ReactNativeEnv {
  constructor(config, context) {
    super(config, context);
    const requested = config.projectConfig.testEnvironmentOptions?.deviceTimeZone;
    const zone = assertTimeZone(
      requested ?? process.env.JEST_DEVICE_TIME_ZONE ?? DEFAULT_DEVICE_TIME_ZONE,
    );
    process.env.TZ = zone;
    // The sandbox's copy of process.env was taken in super(); keep it in step
    // so code that reads process.env.TZ sees the zone Date actually uses.
    if (this.global.process && this.global.process.env) {
      this.global.process.env.TZ = zone;
    }
  }
};

module.exports.DEFAULT_DEVICE_TIME_ZONE = DEFAULT_DEVICE_TIME_ZONE;
