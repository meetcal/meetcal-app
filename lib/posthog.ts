import PostHog from 'posthog-react-native';
import Constants from 'expo-constants';

// Initialize PostHog
const posthog = new PostHog(
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY || '',
  {
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
  }
);

// Set app version
posthog.capture('$app_version', {
  version: Constants.expoConfig?.version || 'unknown'
});

export { posthog }; 