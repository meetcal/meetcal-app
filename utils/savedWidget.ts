import { NativeModules, Platform } from 'react-native';
import { SavedSession } from '@/hooks/useSavedSessions';
import { MeetName } from '@/data/types/meet';

const isAndroid = Platform.OS === 'android';

export const syncSavedWidget = (selectedMeet: MeetName | null, sessions: SavedSession[]) => {
  if (!isAndroid) return;

  const module = NativeModules.SavedWidget;
  if (!module?.updateSavedWidget) return;

  const filtered = selectedMeet
    ? sessions.filter(session => session.meet === selectedMeet)
    : [];

  const widgetSessions = filtered.map(session => ({
    platform: session.platform,
    session_number: session.sessionNumber,
    start_time: session.startTime,
    weight_class: session.weightClass,
    date: session.date,
  }));

  try {
    module.updateSavedWidget(selectedMeet ?? '', JSON.stringify(widgetSessions));
  } catch (error) {
    console.warn('SavedWidget update failed', error);
  }
};

export const clearSavedWidget = () => {
  if (!isAndroid) return;

  const module = NativeModules.SavedWidget;
  if (!module?.clearSavedWidget) return;

  try {
    module.clearSavedWidget();
  } catch (error) {
    console.warn('SavedWidget clear failed', error);
  }
};
