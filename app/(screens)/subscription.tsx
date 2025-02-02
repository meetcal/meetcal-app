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
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

export default function SubscriptionScreen() {
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const [products, setProducts] = useState<InAppPurchases.IAPItemDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setSubscribed } = useSubscription();
  const router = useRouter();
  
  const initializePurchases = async () => {
    try {
      console.log('Starting StoreKit initialization...');
      console.log('App Bundle ID:', Constants.expoConfig?.ios?.bundleIdentifier);
      console.log('Development Mode:', __DEV__ ? 'Yes' : 'No');
      
      await InAppPurchases.connectAsync();
      console.log('Successfully connected to StoreKit');
      
      // Give StoreKit a moment to fully initialize
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (!PRODUCT_IDS) {
        throw new Error('No product IDs configured for this platform');
      }

      // Try to get products multiple times if needed
      let attempts = 0;
      let results: InAppPurchases.IAPItemDetails[] = [];
      
      while (attempts < 3 && results.length === 0) {
        console.log(`Attempt ${attempts + 1} to fetch products:`, PRODUCT_IDS);
        
        const response = await InAppPurchases.getProductsAsync(PRODUCT_IDS);
        console.log('StoreKit response code:', response.responseCode);
        
        if (response.responseCode === InAppPurchases.IAPResponseCode.OK) {
          results = response.results || [];
          console.log('Products found:', results.length);
          if (results.length > 0) {
            console.log('Product details:', results.map(p => ({
              id: p.productId,
              title: p.title,
              price: p.price
            })));
            break;
          }
        }
        
        attempts++;
        if (attempts < 3) {
          console.log('Waiting before next attempt...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (results.length === 0) {
        setError(
          'Unable to load products. Please verify:\n' +
          '1. You are signed in with a sandbox account\n' +
          '2. The app has been completely restarted\n' +
          '3. Your sandbox account region matches the app'
        );
      } else {
        setProducts(results);
        setError(null);
      }

      InAppPurchases.setPurchaseListener(async ({ responseCode, results = [], errorCode }) => {
        if (responseCode === InAppPurchases.IAPResponseCode.OK) {
          try {
            for (const purchase of results) {
              if (!purchase.acknowledged) {
                await InAppPurchases.finishTransactionAsync(purchase, true);
              }
            }
            
            // Set subscription status and redirect
            await setSubscribed(true);
            
            // Verify subscription was saved before continuing
            const status = await AsyncStorage.getItem('subscriptionStatus');
            if (status !== 'true') {
              throw new Error('Failed to save subscription status');
            }

            Alert.alert(
              'Success', 
              'Thank you for subscribing to MeetCal Pro!',
              [
                {
                  text: 'OK',
                  onPress: () => {
                    router.replace('/(tabs)/schedule');
                  }
                }
              ]
            );
          } catch (err) {
            console.error('Error processing purchase:', err);
            Alert.alert(
              'Error',
              'Your purchase was successful but there was an error activating your subscription. Please contact support.',
              [
                {
                  text: 'OK',
                  onPress: () => setLoading(false)
                }
              ]
            );
          }
        } else {
          console.error('Purchase error:', errorCode);
          
          if (errorCode?.includes('Authentication Failed') || 
              errorCode?.includes('ASDErrorDomain')) {
            Alert.alert(
              'Authentication Error',
              'Please sign out of the App Store in Settings, sign back in with your sandbox account, and try again.'
            );
          } else {
            Alert.alert('Error', 'Failed to complete purchase. Please try again.');
          }
        }
        setLoading(false);
      });

    } catch (err) {
      console.error('Failed to initialize purchases:', err);
      setError(
        `Failed to initialize purchases: ${err instanceof Error ? err.message : 'Unknown error'}. 
        Please make sure you're signed into the App Store and try again.`
      );
    }
  };

  useEffect(() => {
    initializePurchases();

    return () => {
      // Need to remove purchase listener before disconnecting
      InAppPurchases.setPurchaseListener(null);
      InAppPurchases.disconnectAsync().catch(console.error);
    };
  }, []);

  const handlePurchase = async (productId: string) => {
    try {
      setLoading(true);
      const product = products.find(p => p.productId === productId);
      
      if (!product) {
        throw new Error('Product not found');
      }

      await InAppPurchases.purchaseItemAsync(product.productId);
    } catch (err) {
      console.error('Purchase error:', err);
      
      // Check for authentication error
      if (err instanceof Error && 
          (err.message.includes('Authentication Failed') || 
           err.message.includes('ASDErrorDomain'))) {
        Alert.alert(
          'Authentication Error',
          'Please sign out of the App Store in Settings, sign back in with your sandbox account, and try again.',
          [
            {
              text: 'OK',
              onPress: () => setLoading(false)
            }
          ]
        );
      } else {
        Alert.alert(
          'Purchase Error',
          'Failed to start purchase. Please try again.',
          [
            {
              text: 'OK',
              onPress: () => setLoading(false)
            }
          ]
        );
      }
      setLoading(false);
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
          headerShown: false
        }} 
      />
      
      <View style={[
        styles.card, 
        { 
          backgroundColor: colors.card,
          marginTop: insets.top + 20
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
              style={[styles.subscribeButton, loading && styles.subscribeButtonDisabled]}
              onPress={() => handlePurchase('quarterly_meetcal')}
              disabled={loading}
            >
              <View style={styles.buttonContent}>
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <ThemedText style={styles.subscribeText}>
                    Subscribe - {products.find(p => p.productId === 'quarterly_meetcal')?.price || '$10'} Per Quarter
                  </ThemedText>
                )}
              </View>
            </Pressable>

            <Pressable 
              style={[styles.subscribeButton, loading && styles.subscribeButtonDisabled]}
              onPress={() => handlePurchase('yearly_meetcal')}
              disabled={loading}
            >
              <View style={styles.buttonContent}>
                {loading ? (
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