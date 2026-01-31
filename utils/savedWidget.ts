import { NativeModules } from 'react-native';
import { SavedSession } from '@/hooks/useSavedSessions';
import { MeetName } from '@/data/types/meet';

export const syncSavedWidget = (selectedMeet: MeetName | null, sessions: SavedSession[]) => {
  const module = NativeModules.SavedWidget;
  if (!module?.updateSavedWidget) {
    console.log('[Widget] Native module not available');
    return;
  }

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

  console.log(`[Widget] Syncing: meet="${selectedMeet}", sessions=${widgetSessions.length}`);
  
  try {
    module.updateSavedWidget(selectedMeet ?? '', JSON.stringify(widgetSessions));
  } catch (error) {
    console.warn('SavedWidget update failed', error);
  }
};

export const clearSavedWidget = () => {
  const module = NativeModules.SavedWidget;
  if (!module?.clearSavedWidget) return;

  try {
    module.clearSavedWidget();
  } catch (error) {
    console.warn('SavedWidget clear failed', error);
  }
};
