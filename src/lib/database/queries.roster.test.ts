import type { MeetName } from '@/data/types/meet';
import { fetchApiAthletes, fetchApiRosterTagged } from '@/lib/api/meets-api';
import { fetchRosterTagged } from '@/lib/database/queries';

jest.mock('@/lib/api/meets-api', () => ({
  ...jest.requireActual('@/lib/api/meets-api'),
  fetchApiRosterTagged: jest.fn(),
  fetchApiAthletes: jest.fn(),
}));
jest.mock('@/config/dev-mock-meet', () => ({
  ...jest.requireActual('@/config/dev-mock-meet'),
  isMockedMeet: async () => false,
}));

const MEET = 'Roster Meet' as MeetName;

beforeEach(() => jest.clearAllMocks());

it('shares one request between callers holding the same tag', async () => {
  jest.mocked(fetchApiRosterTagged).mockResolvedValue({ status: 'unchanged', tag: '"r1"' });
  const [first, second] = await Promise.all([fetchRosterTagged(MEET, '"r1"'), fetchRosterTagged(MEET, '"r1"')]);
  expect(first).toEqual({ status: 'unchanged', tag: '"r1"' });
  expect(second).toBe(first);
  expect(fetchApiRosterTagged).toHaveBeenCalledTimes(1);
});

it('falls back to the plain roster, untagged, when the session roster fails', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.mocked(fetchApiRosterTagged).mockRejectedValue(new Error('down'));
  jest.mocked(fetchApiAthletes).mockResolvedValue([]);
  await expect(fetchRosterTagged(MEET, '"r1"')).resolves.toEqual({ status: 'fresh', value: [], tag: null });
});
