import PostHog from 'posthog-react-native';
import Constants from 'expo-constants';

const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? '';
const POSTHOG_HOST =
  process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com';
const isPostHogConfigured = POSTHOG_API_KEY.length > 0;

// One client for the whole app; `PostHogProvider` in `app/_layout.tsx` takes
// it as its `client`. A build without a key (local dev, CI) gets a disabled
// client rather than one that queues events it can never deliver.
const posthog = new PostHog(POSTHOG_API_KEY, {
  host: POSTHOG_HOST,
  disabled: !isPostHogConfigured,
});

// The app-version event used to fire at module import: before the client had
// finished its async setup and even when the key was empty. Wait for the
// client to be ready, and only when there is somewhere to send it.
if (isPostHogConfigured) {
  posthog
    .ready()
    .then(() => {
      posthog.capture('$app_version', {
        version: Constants.expoConfig?.version || 'unknown',
      });
    })
    .catch((error: unknown) => {
      if (__DEV__) console.warn('[posthog] client failed to initialise', error);
    });
}

export { posthog };
