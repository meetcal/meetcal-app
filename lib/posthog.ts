import PostHog from 'posthog-react-native';

// Initialize PostHog
const posthog = new PostHog(
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY || '',
  {
    host: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com',
  }
);

export { posthog }; 