import { OneSignal } from 'react-native-onesignal';

export const MEETCAL_APP_TAG_KEY = 'app_meetcal';
export const MEETCAL_APP_TAG_VALUE = 'true';

export const tagOneSignalUserAsMeetCal = () => {
  try {
    OneSignal.User.addTag(MEETCAL_APP_TAG_KEY, MEETCAL_APP_TAG_VALUE);
  } catch (error) {
    console.warn('Failed to tag the OneSignal user as a MeetCal user:', error);
  }
};
