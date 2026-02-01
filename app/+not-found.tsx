import React from 'react';
import { Link, Redirect, Stack } from 'expo-router';
import { StyleSheet, Image, View, ActivityIndicator } from 'react-native';

import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

export default function NotFoundScreen() {
  return (
    <Redirect href="/(tabs)/(index)" />
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
