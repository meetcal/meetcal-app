import { NativeModules } from 'react-native';
import { SavedSession } from '@/hooks/useSavedSessions';
import { MeetName } from '@/data/types/meet';
import { createSessionDetailsDeepLink } from '@/utils/deepLinks';

let hasLoggedMissingWidgetModule = false;

export const syncSavedWidget = (
  selectedMeet: MeetName | null,
  sessions: SavedSession[],
  eventTimezone?: string
) => {
  const module = NativeModules.SavedWidget;
  if (!module?.updateSavedWidget) {
    if (!hasLoggedMissingWidgetModule) {
      console.log('[Widget] Native module not available');
      hasLoggedMissingWidgetModule = true;
    }
    return;
  }

  const filtered = selectedMeet
    ? sessions.filter(session => session.meet === selectedMeet)
    : [];

  const tz = eventTimezone ?? 'UTC';
  const widgetSessions = filtered.map(session => ({
    id: session.id,
    meet: session.meet,
    platform: session.platform,
    session_number: session.sessionNumber,
    start_time: session.startTime,
    weigh_in_time: session.weighInTime,
    weight_class: session.weightClass,
    date: session.date,
    time_zone: tz,
    url: createSessionDetailsDeepLink({
      id: session.id,
      meet: session.meet,
      sessionNumber: session.sessionNumber,
      platform: session.platform,
      weightClass: session.weightClass,
      startTime: session.startTime,
      weighInTime: session.weighInTime,
      date: session.date,
    }),
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
