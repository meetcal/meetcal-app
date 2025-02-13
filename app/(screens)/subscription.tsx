import { View, StyleSheet, Pressable, Alert, ActivityIndicator, Platform, Linking, Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
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
  ios: ['quarterly_meetcal', 'yearly_meetcal', 'lifetime_meetcal_pro'],
  android: ['meetcal.pro.monthly', 'meetcal.pro.yearly', 'lifetime_meetcal_pro'],
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

// Update the package type helper to handle RC package types
const isLifetimePackage = (pkg: Purchases.Package) => {
  return pkg.packageType === 'LIFETIME' || pkg.identifier === 'lifetime_meetcal_pro';
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
  const params = useLocalSearchParams<{ from?: string }>();
  
  // Update the fetchProducts function to log more details
  const fetchProducts = async () => {
    try {
      const offerings = await Purchases.getOfferings();
      console.log('All offerings:', JSON.stringify(offerings, null, 2));
      
      // Get all products first
      const products = await Purchases.getProducts(PRODUCT_IDS);
      console.log('All available products:', products);
      
      if (offerings.current?.availablePackages.length) {
        // Find the lifetime product
        const lifetimeProduct = products.find(p => p.identifier === 'lifetime_meetcal_pro');
        
        if (lifetimeProduct) {
          // Create a lifetime package that matches RevenueCat's package structure
          const lifetimePackage = {
            identifier: 'lifetime_meetcal_pro',
            packageType: 'LIFETIME',
            offeringIdentifier: 'default',
            product: lifetimeProduct,
            presentedOfferingContext: null
          } as Purchases.Package;

          // Sort packages to ensure correct order
          const sortedPackages = offerings.current.availablePackages.sort((a, b) => {
            if (a.packageType === 'THREE_MONTH') return -1;
            if (b.packageType === 'THREE_MONTH') return 1;
            return 0;
          });

          // Insert lifetime package after yearly subscription
          const allPackages = [
            ...sortedPackages.filter(pkg => pkg.packageType === 'THREE_MONTH'),
            ...sortedPackages.filter(pkg => pkg.packageType === 'ANNUAL'),
            lifetimePackage
          ];
          
          console.log('Updated packages:', allPackages);
          setRevenueCatProducts(allPackages);
          setError(null);
        } else {
          setRevenueCatProducts(offerings.current.availablePackages);
          setError(null);
        }
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
      
      console.log('Starting purchase for:', productId);
      const customerInfo = await Purchases.getCustomerInfo();
      const hasActiveEntitlement = customerInfo.entitlements.active['Subscriptions'] != null;
      
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

      if (productId === 'lifetime_meetcal_pro') {
        // For lifetime purchase, use purchaseProduct instead of purchasePackage
        const { customerInfo: newCustomerInfo } = await Purchases.purchaseProduct(productId);
        console.log('Purchase result:', newCustomerInfo);
        
        if (newCustomerInfo.entitlements.active['Lifetime'] || 
            newCustomerInfo.entitlements.active['Subscriptions']) {
          await setSubscribed(true);
          Alert.alert(
            'Success', 
            'Thank you for purchasing MeetCal Pro!',
            [{ text: 'OK', onPress: () => router.replace('/(tabs)/schedule') }]
          );
        }
      } else {
        // Handle subscription purchases as before
        const packageToPurchase = revenueCatProducts.find(pkg => pkg.identifier === productId);
        if (!packageToPurchase) throw new Error('Product not found');
        
        const { customerInfo: newCustomerInfo } = await Purchases.purchasePackage(packageToPurchase);
        if (newCustomerInfo.entitlements.active['Subscriptions']) {
          await setSubscribed(true);
          Alert.alert(
            'Success', 
            'Thank you for subscribing to MeetCal Pro!',
            [{ text: 'OK', onPress: () => router.replace('/(tabs)/schedule') }]
          );
        }
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
        [{ text: 'OK' }]
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

  const handleSkip = async () => {
    try {
      await setSubscribed(true);
      Alert.alert(
        'Test Mode', 
        'Subscription skipped for testing',
        [
          {
            text: 'OK',
            onPress: () => router.replace('/(tabs)/schedule')
          }
        ]
      );
    } catch (err) {
      console.error('Skip error:', err);
      Alert.alert('Error', 'Failed to skip subscription');
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
          headerShown: false,
          gestureEnabled: params.from === 'info',
          gestureDirection: 'horizontal',
          animation: 'slide_from_right',
        }} 
      />

      {params.from === 'info' && (
        <View style={[styles.header, { marginTop: insets.top }]}>
          <Pressable
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <IconSymbol
              name="chevron.left"
              size={20}
              color="#007AFF"
            />
            <ThemedText style={styles.backText}>Back</ThemedText>
          </Pressable>
        </View>
      )}

      <View style={[
        styles.card, 
        { 
          backgroundColor: colors.card,
          marginTop: params.from === 'info' ? 16 : insets.top + 20
        }
      ]}>
        <View style={styles.contentHeader}>
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
              <View>
                {revenueCatProducts.map((pkg) => {
                  console.log('Rendering package:', pkg.identifier);
                  return (
                    <View key={pkg.identifier} style={styles.subscriptionContainer}>
                      <Pressable 
                        style={[
                          styles.subscribeButton,
                          isLifetimePackage(pkg) && styles.lifetimeButton, 
                          loadingProductId === pkg.identifier && styles.subscribeButtonDisabled
                        ]}
                        onPress={() => handlePurchase(pkg.identifier)}
                        disabled={loadingProductId === pkg.identifier}
                      >
                        {pkg.packageType === 'ANNUAL' && (
                          <View style={[styles.trialBubble, { backgroundColor: colors.card }]}>
                            <Text style={[styles.trialText, { color: colors.text }]}>
                              3 Day Free Trial
                            </Text>
                          </View>
                        )}
                        {isLifetimePackage(pkg) && (
                          <View style={[styles.bestValueBadge, { 
                            backgroundColor: colors.card,
                            borderColor: '#007AFF'
                          }]}>
                            <Text style={[styles.bestValueText, { 
                              color: colors.text
                            }]}>
                              Best Value for Coaches
                            </Text>
                          </View>
                        )}
                        <View style={styles.buttonContent}>
                          {loadingProductId === pkg.identifier ? (
                            <ActivityIndicator color="#FFFFFF" />
                          ) : (
                            <ThemedText style={styles.subscribeText}>
                              {isSubscribed 
                                ? 'Manage Subscription'
                                : (() => {
                                    if (isLifetimePackage(pkg)) {
                                      return `Lifetime Access - ${pkg.product.priceString}`;
                                    }
                                    return `Subscribe - ${pkg.product.priceString}${pkg.product.subscriptionPeriod === 'P3M' ? ' Per Quarter' : ' Per Year'}`;
                                  })()
                              }
                            </ThemedText>
                          )}
                        </View>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
                <ThemedText style={styles.loadingText}>Loading subscription options...</ThemedText>
              </View>
            )}
            
            <View style={styles.bottomButtons}>
              <Pressable
                style={styles.restoreButton}
                onPress={handleRestore}
                disabled={loadingProductId === 'restore'}
              >
                <ThemedText style={[styles.restoreText, { color: colors.secondaryText }]}>
                  Restore Purchase
                </ThemedText>
              </Pressable>
              
              <Pressable
                style={[styles.skipButton]}
                onPress={handleSkip}
              >
                <ThemedText style={styles.skipText}>
                  Skip (Testing Only)
                </ThemedText>
              </Pressable>
            </View>
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: 'relative',
  },
  backButton: {
    position: 'absolute',
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1,
  },
  backText: {
    color: '#007AFF',
    fontSize: 17,
    marginLeft: -4,
  },
  screenTitle: {
    fontSize: 20,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  card: {
    margin: 16,
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
  contentHeader: {
    alignItems: 'center',
    marginBottom: 32,
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
    position: 'relative',
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
  bottomButtons: {
    marginTop: 16,
  },
  restoreButton: {
    alignItems: 'center',
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
  subscriptionContainer: {
    marginBottom: 18,
  },
  trialBubble: {
    position: 'absolute',
    top: -10,
    right: -10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#007AFF',
    zIndex: 1,
  },
  trialText: {
    fontSize: 12,
    fontWeight: '500',
  },
  skipButton: {
    backgroundColor: '#FF9500',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  skipText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  lifetimeButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 20,
  },
  bestValueBadge: {
    position: 'absolute',
    top: -10,
    right: -10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    zIndex: 1,
  },
  bestValueText: {
    fontSize: 12,
    fontWeight: '600',
  },
  lifetimeSubtext: {
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },
}); 