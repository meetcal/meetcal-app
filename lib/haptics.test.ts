import * as Haptics from 'expo-haptics';
import { errorNotification, lightImpact, successNotification } from './haptics';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

const impactAsync = Haptics.impactAsync as jest.Mock;
const notificationAsync = Haptics.notificationAsync as jest.Mock;

describe('shared haptic policy', () => {
  beforeEach(() => {
    impactAsync.mockReset().mockResolvedValue(undefined);
    notificationAsync.mockReset().mockResolvedValue(undefined);
  });

  // jest-expo inlines process.env.EXPO_OS to "ios", so these assert the iOS
  // branch. The Android branch is a bundle-time constant fold.
  it('plays a light impact for taps', () => {
    lightImpact();
    expect(impactAsync).toHaveBeenCalledWith('light');
  });

  it('distinguishes success from error notifications', () => {
    successNotification();
    errorNotification();
    expect(notificationAsync.mock.calls).toEqual([['success'], ['error']]);
  });

  it('swallows a rejected haptic instead of leaking an unhandled rejection', async () => {
    impactAsync.mockRejectedValue(new Error('no taptic engine'));
    notificationAsync.mockRejectedValue(new Error('no taptic engine'));

    expect(() => {
      lightImpact();
      successNotification();
      errorNotification();
    }).not.toThrow();

    // Let the rejections settle; an unhandled one would fail the suite.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
