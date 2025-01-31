import { View, StyleSheet, Pressable } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';

export default function SubscriptionScreen() {
  const { currentTheme } = useTheme();
  
  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#F5F5F5',
    card: currentTheme === 'dark' ? '#1C1C1E' : '#FFFFFF',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
    border: currentTheme === 'dark' ? '#38383A' : '#E1E1E1',
  };

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen 
        options={{ 
          title: 'Premium Features',
          headerBackTitle: 'Back'
        }} 
      />
      
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>Unlock Premium Features</ThemedText>
          <ThemedText style={[styles.subtitle, { color: colors.secondaryText }]}>
            Enhance your competition experience
          </ThemedText>
        </View>

        <View style={styles.features}>
          <Feature
            icon="star.fill"
            title="Athlete Tracking"
            description="Follow specific athletes and get notified when they lift"
            colors={colors}
          />
          <Feature
            icon="bell.fill"
            title="Custom Alerts"
            description="Set up alerts for specific sessions, platforms, or weight classes"
            colors={colors}
          />
          <Feature
            icon="chart.bar.fill"
            title="Advanced Statistics"
            description="Access detailed performance analytics and historical data"
            colors={colors}
          />
        </View>

        <Pressable style={styles.subscribeButton}>
          <ThemedText style={styles.subscribeText}>Subscribe - $4.99/month</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

function Feature({ icon, title, description, colors }: { 
  icon: string; 
  title: string; 
  description: string;
  colors: any;
}) {
  return (
    <View style={styles.feature}>
      <IconSymbol name={icon} size={24} color="#007AFF" />
      <View style={styles.featureText}>
        <ThemedText style={styles.featureTitle}>{title}</ThemedText>
        <ThemedText style={[styles.featureDescription, { color: colors.secondaryText }]}>
          {description}
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  card: {
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 17,
    textAlign: 'center',
  },
  features: {
    marginBottom: 32,
    gap: 24,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 4,
  },
  featureDescription: {
    fontSize: 15,
    lineHeight: 20,
  },
  subscribeButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  subscribeText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
}); 