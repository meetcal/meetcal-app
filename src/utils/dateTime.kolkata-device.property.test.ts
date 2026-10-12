/**
 * @jest-environment-options {"deviceTimeZone": "Asia/Kolkata"}
 */
import { describeDeviceZoneProperties } from '@/test-support/device-zone-properties';

// The device-zone sweep on Asia/Kolkata: a half-hour offset east of UTC, but less than
// 12 hours ahead, unlike Auckland.
describeDeviceZoneProperties('Asia/Kolkata');
