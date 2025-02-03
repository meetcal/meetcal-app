import { View, StyleSheet, Pressable, Alert, ActivityIndicator, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import * as InAppPurchases from 'expo-in-app-purchases';
import { useEffect, useState } from 'react';
import Constants from 'expo-constants';
import { SFSymbol } from '@/types/SFSymbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useLocalStorage } from '@/contexts/LocalStorageContext';
import { StorageKeys } from '@/constants/StorageKeys';
import { storage } from '@/utils/storage';

// Product IDs for both platforms
const PRODUCT_IDS = Platform.select({
  ios: ['quarterly_meetcal', 'yearly_meetcal'],
  android: ['meetcal.pro.monthly', 'meetcal.pro.yearly'],
});

// Update the Feature component props type
type FeatureProps = {
  icon: SFSymbol;
  title: string;
  description: string;
  colors: {
    secondaryText: string;
  };
};

const HAS_SEEN_SUBSCRIPTION = 'hasSeenSubscription';

export default function SubscriptionScreen() {
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [products, setProducts] = useState<InAppPurchases.IAPItemDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setSubscribed } = useSubscription();
  const router = useRouter();
  const { setHasSeenSubscription } = useOnboarding();
  const [loadingProduct, setLoadingProduct] = useState<string | null>(null);
  
  const initializePurchases = async () => {
    try {
      console.log('Starting StoreKit initialization...');
      console.log('App Bundle ID:', Constants.expoConfig?.ios?.bundleIdentifier);
      console.log('Development Mode:', __DEV__ ? 'Yes' : 'No');

      // First disconnect to ensure clean state
      await InAppPurchases.disconnectAsync().catch(() => {});
      
      // Set up listener before connecting
      InAppPurchases.setPurchaseListener(({ responseCode, results = [] }) => {
        if (responseCode === InAppPurchases.IAPResponseCode.OK) {
          (async () => {
            try {
              // Finish the transaction
              for (const purchase of results) {
                if (!purchase.acknowledged) {
                  await InAppPurchases.finishTransactionAsync(purchase, true);
                }
              }
              
              // Update subscription status
              storage.set(HAS_SEEN_SUBSCRIPTION, true);
              setHasSeenSubscription(true);
              await setSubscribed(true);
              
              Alert.alert(
                'Success',
                'Thank you for subscribing to MeetCal Pro!',
                [
                  {
                    text: 'OK',
                    onPress: () => router.replace('/(tabs)/schedule')
                  }
                ]
              );
            } catch (err) {
              console.error('Error processing purchase:', err);
              setError('Failed to complete purchase. Please try again.');
            } finally {
              setLoadingProduct(null);
            }
          })();
        } else {
          setError('Purchase failed. Please try again.');
          setLoadingProduct(null);
        }
      });

      // Then connect to StoreKit
      await InAppPurchases.connectAsync();
      console.log('Successfully connected to StoreKit');

      if (!PRODUCT_IDS) {
        throw new Error('No product IDs configured for this platform');
      }

      // Get products
      const response = await InAppPurchases.getProductsAsync(PRODUCT_IDS);
      console.log('StoreKit response code:', response.responseCode);

      if (response.responseCode === InAppPurchases.IAPResponseCode.OK) {
        const results = response.results || [];
        console.log('Products found:', results.length);
        if (results.length > 0) {
          setProducts(results);
          setError(null);
        } else {
          setError('No products available. Please try again later.');
        }
      }

    } catch (err) {
      console.error('Failed to initialize purchases:', err);
      setError('Failed to initialize purchases. Please try again.');
    }
  };

  useEffect(() => {
    initializePurchases();

    return () => {
      InAppPurchases.setPurchaseListener(null);
      InAppPurchases.disconnectAsync().catch(() => {});
    };
  }, []);

  const handlePurchase = async (productId: string) => {
    try {
      if (loadingProduct) return; // Prevent multiple purchases at once
      
      setLoadingProduct(productId);
      setError(null);

      const product = products.find(p => p.productId === productId);
      if (!product) {
        throw new Error('Product not found');
      }

      await InAppPurchases.purchaseItemAsync(productId);
    } catch (err) {
      console.error('Purchase error:', err);
      setError('Failed to start purchase. Please try again.');
      setLoadingProduct(null);
    }
  };

  const handleSkip = async () => {
    try {
      storage.set(HAS_SEEN_SUBSCRIPTION, true);
      setHasSeenSubscription(true);
      router.replace('/(tabs)/schedule');
    } catch (err) {
      console.error('Failed to mark subscription as seen:', err);
      Alert.alert(
        'Error',
        'Failed to save settings. Please try again.',
        [{ text: 'OK' }]
      );
    }
  };

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
          headerBackTitle: 'Back',
          headerShown: true,
          presentation: 'push',
          headerRight: () => (
            <Pressable onPress={handleSkip}>
              <ThemedText style={{ color: '#007AFF', fontSize: 17 }}>
                Skip
              </ThemedText>
            </Pressable>
          ),
        }} 
      />
      
      <View style={[
        styles.card, 
        { 
          backgroundColor: colors.card,
          marginTop: 20
        }
      ]}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>Unlock Premium Features</ThemedText>
          <ThemedText style={[styles.subtitle, { color: colors.secondaryText }]}>
            Enhance your competition experience
          </ThemedText>
        </View>

        <View style={styles.features}>
          <Feature
            icon="calendar"
            title="Calendar Made Simple"
            description="The PDF calendar is hard to read and hard to find. Have your whole competition schedule simple and clean."
            colors={colors}
          />
          <Feature
            icon="bookmark.fill"
            title="Save Sessions"
            description="Save sessions to the app or directly to your calendar. Know exactly where all your athletes and teams are competing in just a quick glance."
            colors={colors}
          />
          <Feature
            icon="line.3.horizontal.decrease"
            title="Filter Views"
            description="Filter your views by weight class, platform, even by club. Take control of the schedule in a way you've never seen before."
            colors={colors}
          />
        </View>

        {error ? (
          <View style={styles.loadingContainer}>
            <ThemedText style={[styles.loadingText, { color: '#FF3B30' }]}>
              {error}
            </ThemedText>
            <ThemedText style={[styles.helpText, { color: colors.secondaryText }]}>
              Make sure you're signed into the App Store and have a valid payment method.
            </ThemedText>
            <Pressable
              style={[styles.retryButton, { marginTop: 12 }]}
              onPress={() => {
                setError(null);
                initializePurchases();
              }}
            >
              <ThemedText style={styles.retryText}>Retry</ThemedText>
            </Pressable>
          </View>
        ) : products.length > 0 ? (
          <>
            <Pressable 
              style={[
                styles.subscribeButton, 
                loadingProduct === 'quarterly_meetcal' && styles.subscribeButtonDisabled
              ]}
              onPress={() => handlePurchase('quarterly_meetcal')}
              disabled={!!loadingProduct}
            >
              <View style={styles.buttonContent}>
                {loadingProduct === 'quarterly_meetcal' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <ThemedText style={styles.subscribeText}>
                    Subscribe - {products.find(p => p.productId === 'quarterly_meetcal')?.price || '$10'} Per Quarter
                  </ThemedText>
                )}
              </View>
            </Pressable>

            <Pressable 
              style={[
                styles.subscribeButton, 
                loadingProduct === 'yearly_meetcal' && styles.subscribeButtonDisabled
              ]}
              onPress={() => handlePurchase('yearly_meetcal')}
              disabled={!!loadingProduct}
            >
              <View style={styles.buttonContent}>
                {loadingProduct === 'yearly_meetcal' ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <ThemedText style={styles.subscribeText}>
                    Subscribe - {products.find(p => p.productId === 'yearly_meetcal')?.price || '$30'} Per Year
                  </ThemedText>
                )}
              </View>
            </Pressable>
          </>
        ) : (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <ThemedText style={styles.loadingText}>Loading subscription options...</ThemedText>
          </View>
        )}
      </View>
    </ThemedView>
  );
}

// Update the Feature component to use proper icon type
function Feature({ icon, title, description, colors }: FeatureProps) {
  return (
    <View style={styles.feature}>
      <IconSymbol name={icon as SFSymbol} size={24} color="#007AFF" />
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
    paddingTop: 8,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 34,
  },
  subtitle: {
    fontSize: 17,
    textAlign: 'center',
    paddingHorizontal: 16,
    lineHeight: 22,
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
    marginTop: 12,
  },
  subscribeText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  subscribeButtonDisabled: {
    opacity: 0.6,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#8E8E93',
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  helpText: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 20,
  },
}); 