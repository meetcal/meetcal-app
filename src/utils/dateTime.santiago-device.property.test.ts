/**
 * @jest-environment-options {"deviceTimeZone": "America/Santiago"}
 */
import { describeDeviceZoneProperties } from '@/test-support/device-zone-properties';

// The device-zone sweep on America/Santiago: its DST changes at midnight, so some local
// midnights do not exist.
describeDeviceZoneProperties('America/Santiago');
