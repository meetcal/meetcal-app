import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { useSavedSessions } from '@/contexts/SavedSessionsContext';

// Import the native module (this will be available after widget setup)
let MeetCalWidgets: any = null;

try {
  if (Platform.OS === 'ios') {
    // On iOS, this will be available through the expo-widgets module
    MeetCalWidgets = require('@bittingz/expo-widgets');
  }
} catch (error) {
  console.log('Widgets module not available:', error);
}

// For Android, we'll use shared preferences directly
import AsyncStorage from '@react-native-async-storage/async-storage';

export function useWidgets() {
  const { selectedMeet, availableMeets } = useSelectedMeet();
  const { savedSessions } = useSavedSessions();

  const updateWidgetData = async () => {
    const widgetData = {
      selectedMeet: selectedMeet,
      availableMeets: availableMeets.map(meet => ({
        name: meet.name,
        status: meet.status || 'upcoming'
      })),
      savedSessions: savedSessions.map(session => ({
        id: session.id,
        meet: session.meet,
        sessionNumber: session.sessionNumber,
        platform: session.platform,
        weightClass: session.weightClass,
        startTime: session.startTime,
        date: session.date,
        athleteNames: session.athleteNames || []
      }))
    };

    try {
      if (Platform.OS === 'ios' && MeetCalWidgets?.updateWidgetData) {
        // Update iOS widgets through the native module
        await MeetCalWidgets.updateWidgetData(widgetData);
      } else if (Platform.OS === 'android') {
        // For Android, store data in AsyncStorage with specific keys that widgets can access
        await AsyncStorage.setItem('@widget_selected_meet', selectedMeet || '');
        await AsyncStorage.setItem('@widget_available_meets', JSON.stringify(widgetData.availableMeets));
        await AsyncStorage.setItem('@widget_saved_sessions', JSON.stringify(widgetData.savedSessions));
        
        // TODO: Trigger widget update on Android
        // This would require additional native module setup for Android widget updates
      }
    } catch (error) {
      console.error('Failed to update widget data:', error);
    }
  };

  // Update widgets whenever the data changes
  useEffect(() => {
    updateWidgetData();
  }, [selectedMeet, availableMeets, savedSessions]);

  return {
    updateWidgetData
  };
}

// Utility function to handle deep links from widgets
export function handleWidgetDeepLink(url: string) {
  const uri = url.replace('meetcal://', '');
  
  switch (uri) {
    case 'select-meet':
      // Navigate to meet selection (this could open a modal or navigate to the main screen)
      console.log('Widget tapped: Select meet');
      return { action: 'select-meet' };
      
    case 'saved-sessions':
      // Navigate to saved sessions screen
      console.log('Widget tapped: Saved sessions');
      return { action: 'saved-sessions' };
      
    default:
      console.log('Unknown widget deep link:', url);
      return { action: 'home' };
  }
}