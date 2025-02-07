import React, { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { getSessionDetails } from '../data/schedule';
import { schedule } from '@/data/schedule';
import { View, StyleSheet, Pressable } from 'react-native';
import { ThemedText } from '@/components/ThemedText';

const StartList: React.FC = () => {
  const router = useRouter();

  const handleSessionPress = useCallback(() => {
    if (!athlete.session) return;

    const sessionDay = schedule.find(day => 
      day.sessions.some(s => s.number === athlete.session.number)
    );
    
    const session = sessionDay?.sessions.find(s => 
      s.number === athlete.session.number
    );

    if (!session) {
      console.error('Session not found:', athlete.session.number);
      return;
    }

    const platformData = session.platforms.find(p => 
      p.platform === athlete.session.platform
    );

    if (!platformData) {
      console.error('Platform data not found:', {
        session: athlete.session.number,
        platform: athlete.session.platform
      });
      return;
    }

    router.push({
      pathname: '/(screens)/schedule-details',
      params: {
        id: `session-${athlete.session.number}-${athlete.session.platform}`,
        sessionNumber: athlete.session.number,
        platform: athlete.session.platform,
        weightClass: platformData.weightClass,
        startTime: session.startTime,
        weighInTime: session.weighInTime,
        date: sessionDay?.fullDate || '',
      }
    });
  }, [router, athlete.session]);

  return (
    <div>
      {/* Render your component content here */}
    </div>
  );
};

function AthleteItem({ athlete }: { athlete: any }) {
  const router = useRouter();

  // Get the session details including weight class
  const sessionDetails = React.useMemo(() => {
    if (!athlete.session) return null;

    const sessionDay = schedule.find(day => 
      day.sessions.some(s => s.number === athlete.session.number)
    );
    
    const session = sessionDay?.sessions.find(s => 
      s.number === athlete.session.number
    );

    const platformData = session?.platforms.find(p => 
      p.platform === athlete.session.platform
    );

    if (!session || !platformData) return null;

    return {
      date: sessionDay?.fullDate || '',
      startTime: session.startTime,
      weighInTime: session.weighInTime,
      weightClass: platformData.weightClass,
      sessionNumber: session.number,
      platform: platformData.platform
    };
  }, [athlete.session]);

  const handleSessionPress = () => {
    if (!sessionDetails) return;

    router.push({
      pathname: '/(screens)/schedule-details',
      params: {
        id: `session-${sessionDetails.sessionNumber}-${sessionDetails.platform}`,
        sessionNumber: sessionDetails.sessionNumber,
        platform: sessionDetails.platform,
        weightClass: sessionDetails.weightClass,
        startTime: sessionDetails.startTime,
        weighInTime: sessionDetails.weighInTime,
        date: sessionDetails.date,
      }
    });
  };

  return (
    <View>
      <View style={styles.athleteDetails}>
        <ThemedText>{athlete.name}</ThemedText>
        <ThemedText>{athlete.club}</ThemedText>
        {/* Show weight class from schedule.ts */}
        {sessionDetails && (
          <ThemedText>Weight Class: {sessionDetails.weightClass}</ThemedText>
        )}
      </View>
      
      {athlete.session && (
        <Pressable onPress={handleSessionPress}>
          <View style={styles.sessionDetails}>
            <ThemedText>Session {athlete.session.number}</ThemedText>
            <ThemedText>Platform {athlete.session.platform}</ThemedText>
            {sessionDetails && (
              <ThemedText>{sessionDetails.weightClass}</ThemedText>
            )}
          </View>
        </Pressable>
      )}
    </View>
  );
}

export default StartList; 