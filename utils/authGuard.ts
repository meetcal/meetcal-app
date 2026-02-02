import { useRouter } from 'expo-router';
import { useUser } from '@clerk/clerk-expo';
import { Alert } from 'react-native';
import { useCallback } from 'react';

export interface AuthGuardOptions {
  /** Feature being accessed (for analytics/logging) */
  feature: string;
  /** Custom message to show in alert */
  message?: string;
  /** Where to return after auth completes */
  returnPath?: string;
}

/**
 * Hook to guard features that require authentication.
 * Shows login prompt if user is not authenticated.
 */
export function useAuthGuard() {
  const { user, isLoaded } = useUser();
  const router = useRouter();

  /**
   * Check if user is authenticated. If not, show login prompt.
   * @returns true if authenticated, false if login is required, null if still loading
   */
  const requireAuth = useCallback((options: AuthGuardOptions): boolean | null => {
    if (!isLoaded) {
      // Still loading auth state
      return null;
    }

    if (user) {
      // User is authenticated
      return true;
    }

    // User not authenticated - show prompt
    const defaultMessage = 'You need to sign in to use this feature.';

    Alert.alert(
      'Sign In Required',
      options.message || defaultMessage,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Sign In',
          onPress: () => {
            router.push({
              pathname: '/(auth)/sign-in',
              params: {
                from: options.returnPath || '/(tabs)',
                feature: options.feature,
              },
            } as any);
          },
        },
      ]
    );

    return false;
  }, [user, isLoaded, router]);

  return {
    requireAuth,
    isAuthenticated: !!user,
    isLoaded,
  };
}
