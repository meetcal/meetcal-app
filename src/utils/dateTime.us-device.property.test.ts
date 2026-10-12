/**
 * @jest-environment-options {"deviceTimeZone": "America/Los_Angeles"}
 */
import { describeDeviceZoneProperties } from '@/test-support/device-zone-properties';

// The device-zone sweep on America/Los_Angeles: a US meet zone, where UTC midnight read back as local
// is the day before.
describeDeviceZoneProperties('America/Los_Angeles');
