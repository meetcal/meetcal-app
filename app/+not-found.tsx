import React from 'react';
import { Link, Stack } from 'expo-router';
import { StyleSheet, Image, View, ActivityIndicator } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Loading...' }} />
      <ThemedView style={styles.container}>
        <Image
          source={require('@/assets/images/MeetCal-no-bg.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <ActivityIndicator size="large" style={styles.spinner} />
        <ThemedText type="title" style={styles.text}>
          Heading to your page now
        </ThemedText>
        <ThemedText style={styles.subtext}>
          If the page doesn't automatically load,{' '}
          <Link href="/" style={styles.link}>
            <ThemedText type="link">click here</ThemedText>
          </Link>
        </ThemedText>
      </ThemedView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  logo: {
    width: 120,
    height: 60,
    marginBottom: 32,
  },
  spinner: {
    marginBottom: 24,
  },
  text: {
    textAlign: 'center',
    marginBottom: 12,
  },
  subtext: {
    textAlign: 'center',
    color: '#888',
  },
  link: {
    marginLeft: 4,
  },
});
