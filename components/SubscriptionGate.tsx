import { View, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { ThemedText } from './ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { useSubscription } from '@/contexts/SubscriptionContext';

export function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { currentTheme } = useTheme();
  const { isSubscribed } = useSubscription();

  if (isSubscribed) {
    return <>{children}</>;
  }

  return (
    <View style={styles.container}>
      <ThemedText style={styles.title}>Premium Feature</ThemedText>
      <ThemedText style={styles.description}>
        Subscribe to MeetCal Pro to access the athlete list with entry totals 
        and comp PRs, the saved session list, the full entry list, and the
        ability to filter by weight class, session, and club.
      </ThemedText>
      <Pressable
        style={styles.button}
        onPress={() => router.push('/(screens)/subscription')}
      >
        <ThemedText style={styles.buttonText}>View Subscription Options</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
    opacity: 0.7,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
}); 