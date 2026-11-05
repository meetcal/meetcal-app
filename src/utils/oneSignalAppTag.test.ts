import { OneSignal } from 'react-native-onesignal';

import { tagOneSignalUserAsMeetCal } from '@/utils/oneSignalAppTag';

jest.mock('react-native-onesignal', () => ({
  OneSignal: { User: { addTag: jest.fn() } },
}));

const addTag = jest.mocked(OneSignal.User.addTag);

describe('tagOneSignalUserAsMeetCal', () => {
  beforeEach(() => {
    addTag.mockReset();
  });

  it('adds the MeetCal app tag and leaves every other tag alone', () => {
    tagOneSignalUserAsMeetCal();
    expect(addTag).toHaveBeenCalledTimes(1);
    expect(addTag).toHaveBeenCalledWith('app_meetcal', 'true');
  });

  it('does not throw when the native SDK does', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    addTag.mockImplementation(() => {
      throw new Error('OneSignal is not initialized');
    });
    expect(() => tagOneSignalUserAsMeetCal()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
