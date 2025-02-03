import { View, StyleSheet, Pressable, Alert, ActivityIndicator, Platform, Linking } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { useEffect, useState } from 'react';
import { SFSymbol } from '@/types/SFSymbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Purchases from 'react-native-purchases';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { setSubscribed, restorePurchases, isSubscribed } = useSubscription();
  const router = useRouter();
  const [revenueCatProducts, setRevenueCatProducts] = useState<Purchases.Package[]>([]);
  const [loadingProductId, setLoadingProductId] = useState<string | null>(null);
  
  const fetchProducts = async () => {
    try {
      const offerings = await Purchases.getOfferings();
      if (offerings.current?.availablePackages.length) {
        setRevenueCatProducts(offerings.current.availablePackages);
        setError(null);
      } else {
        setError('No subscription options available');
      }
    } catch (err) {
      console.error('Failed to fetch products:', err);
      setError('Failed to load subscription options');
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  const handlePurchase = async (productId: string) => {
    try {
      setLoadingProductId(productId);
      
      console.log('Checking current subscription before purchase...');
      const customerInfo = await Purchases.getCustomerInfo();
      const hasActiveEntitlement = customerInfo.entitlements.active['Subscriptions'] != null;
      console.log('Purchase check - subscription status:', hasActiveEntitlement);
      
      if (hasActiveEntitlement) {
        Alert.alert(
          'Already Subscribed',
          'You already have an active subscription. Would you like to manage your subscription?',
          [
            {
              text: 'Manage Subscription',
              onPress: handleManageSubscription
            },
            {
              text: 'Cancel',
              style: 'cancel'
            }
          ]
        );
        return;
      }

      const revenueCatPackage = revenueCatProducts.find(pkg => pkg.identifier === productId);
      
      if (!revenueCatPackage) {
        throw new Error('Product not found');
      }

      const { customerInfo: newCustomerInfo } = await Purchases.purchasePackage(revenueCatPackage);
      
      if (newCustomerInfo.entitlements.active['Subscriptions']) {
        await setSubscribed(true);
        
        // Verify subscription was saved
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
              onPress: () => router.replace('/(tabs)/schedule')
            }
          ]
        );
      }
    } catch (err) {
      console.error('Purchase error:', err);
      
      if (err instanceof Error && 
          (err.message.includes('User cancelled') || 
           err.message.includes('cancelled'))) {
        return;
      }

      Alert.alert(
        'Purchase Error',
        'Failed to complete purchase. Please try again.',
        [
          {
            text: 'OK'
          }
        ]
      );
    } finally {
      setLoadingProductId(null);
    }
  };

  const handleRestore = async () => {
    setLoadingProductId('restore');
    try {
      const restored = await restorePurchases();
      if (restored) {
        Alert.alert(
          'Success',
          'Your subscription has been restored!',
          [
            {
              text: 'OK',
              onPress: () => router.replace('/(tabs)/schedule')
            }
          ]
        );
      } else {
        Alert.alert(
          'No Subscription Found',
          'No active subscription was found to restore.'
        );
      }
    } catch (error) {
      Alert.alert(
        'Error',
        'Failed to restore subscription. Please try again.'
      );
    } finally {
      setLoadingProductId(null);
    }
  };

  const handleManageSubscription = async () => {
    try {
      setLoadingProductId('manage');
      
      // Get customer info to get management URL
      const customerInfo = await Purchases.getCustomerInfo();
      
      if (Platform.OS === 'ios') {
        // Try management URL first
        if (customerInfo.managementURL) {
          await Linking.openURL(customerInfo.managementURL);
        } else {
          // Fallback to subscriptions settings
          await Linking.openURL('itms-apps://apps.apple.com/account/subscriptions');
        }
      } else {
        // Android handling
        await Linking.openSettings();
      }
    } catch (error) {
      console.error('Failed to open subscription settings:', error);
      // Last resort fallback
      if (Platform.OS === 'ios') {
        Linking.openURL('itms-apps://apps.apple.com/account/subscriptions').catch(() => {
          // If that fails, open general settings
          Linking.openSettings();
        });
      } else {
        Linking.openSettings();
      }
    } finally {
      setLoadingProductId(null);
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
          <ThemedText style={styles.title}>
            {isSubscribed ? 'MeetCal Pro' : 'Unlock Premium Features'}
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: colors.secondaryText }]}>
            {isSubscribed 
              ? 'You have full access to all premium features'
              : 'Enhance your competition experience'
            }
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

        {isSubscribed ? (
          <Pressable 
            style={[
              styles.manageButton, 
              loadingProductId === 'manage' && styles.buttonDisabled
            ]}
            onPress={handleManageSubscription}
            disabled={loadingProductId === 'manage'}
          >
            <View style={styles.buttonContent}>
              {loadingProductId === 'manage' ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <ThemedText style={styles.buttonText}>
                  Manage Subscription
                </ThemedText>
              )}
            </View>
          </Pressable>
        ) : (
          <>
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
                    fetchProducts();
                  }}
                >
                  <ThemedText style={styles.retryText}>Retry</ThemedText>
                </Pressable>
              </View>
            ) : revenueCatProducts.length > 0 ? (
              <>
                {revenueCatProducts.map((pkg) => (
                  <Pressable 
                    key={pkg.identifier}
                    style={[
                      styles.subscribeButton, 
                      loadingProductId === pkg.identifier && styles.subscribeButtonDisabled
                    ]}
                    onPress={() => handlePurchase(pkg.identifier)}
                    disabled={loadingProductId === pkg.identifier}
                  >
                    <View style={styles.buttonContent}>
                      {loadingProductId === pkg.identifier ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <ThemedText style={styles.subscribeText}>
                          {isSubscribed 
                            ? 'Manage Subscription'
                            : `Subscribe - ${pkg.product.priceString} ${pkg.packageType === 'QUARTERLY' ? 'Per Quarter' : 'Per Year'}`
                          }
                        </ThemedText>
                      )}
                    </View>
                  </Pressable>
                ))}
                
                <View style={styles.bottomButtons}>
                  <Pressable
                    style={styles.skipButton}
                    onPress={() => router.replace('/(tabs)/schedule')}
                  >
                    <ThemedText style={[styles.skipText, { color: colors.secondaryText }]}>
                      Skip for now
                    </ThemedText>
                  </Pressable>
                  
                  <Pressable
                    style={styles.restoreButton}
                    onPress={handleRestore}
                    disabled={loadingProductId === 'restore'}
                  >
                    <ThemedText style={[styles.restoreText, { color: colors.secondaryText }]}>
                      Restore Purchase
                    </ThemedText>
                  </Pressable>
                </View>
              </>
            ) : (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
                <ThemedText style={styles.loadingText}>Loading subscription options...</ThemedText>
              </View>
            )}
          </>
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
  skipButton: {
    alignItems: 'center',
    padding: 16,
    marginTop: 16,
  },
  skipText: {
    fontSize: 15,
  },
  bottomButtons: {
    marginTop: 16,
    gap: 8,
  },
  restoreButton: {
    alignItems: 'center',
    padding: 16,
  },
  restoreText: {
    fontSize: 15,
  },
  manageButton: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
}); 