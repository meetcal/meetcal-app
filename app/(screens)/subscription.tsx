import { View, StyleSheet, Pressable, Alert, ActivityIndicator, Platform } from 'react-native';
import { Stack } from 'expo-router';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import * as InAppPurchases from 'expo-in-app-purchases';
import { useEffect, useState } from 'react';
import Constants from 'expo-constants';

// Product IDs for the subscriptions
const QUARTERLY_SUB = 'quarterly_meetcal';
const YEARLY_SUB = 'yearly_meetcal';

export default function SubscriptionScreen() {
  const { currentTheme } = useTheme();
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<InAppPurchases.IAPItemDetails[]>([]);
  
  useEffect(() => {
    initializePurchases();
  }, []);

  const initializePurchases = async () => {
    try {
      // Only initialize purchases in production or TestFlight
      if (__DEV__ && Platform.OS === 'ios') {
        console.log('Skipping IAP initialization in development');
        return;
      }

      await InAppPurchases.connectAsync();
      
      // Load the products
      const { responseCode, results } = await InAppPurchases.getProductsAsync([
        QUARTERLY_SUB,
        YEARLY_SUB
      ]);
      
      if (responseCode === InAppPurchases.IAPResponseCode.OK) {
        setProducts(results);
      }

      // Set up purchase listener
      InAppPurchases.setPurchaseListener(({ responseCode, results, errorCode }) => {
        if (responseCode === InAppPurchases.IAPResponseCode.OK) {
          results.forEach(async (purchase) => {
            if (!purchase.acknowledged) {
              // Finish the transaction
              await InAppPurchases.finishTransactionAsync(purchase, true);
              
              // Update user's subscription status
              // You'll need to implement this based on your backend
              await updateUserSubscription(purchase);
            }
          });
        }

        if (errorCode) {
          Alert.alert('Error', 'There was an error with the purchase. Please try again.');
        }
        
        setLoading(false);
      });
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to initialize purchases');
    }
  };

  const handlePurchase = async (productId: string) => {
    try {
      setLoading(true);
      
      // Connect to store
      await InAppPurchases.connectAsync();
      
      // Get products
      const { responseCode, results } = await InAppPurchases.getProductsAsync([
        productId
      ]);
      
      if (responseCode !== InAppPurchases.IAPResponseCode.OK) {
        throw new Error('Failed to load products');
      }

      if (results.length === 0) {
        throw new Error('No products available');
      }

      // Purchase
      const { responseCode: purchaseResponseCode, results: purchaseResults } = 
        await InAppPurchases.purchaseItemAsync(productId);

      if (purchaseResponseCode === InAppPurchases.IAPResponseCode.USER_CANCELED) {
        console.log('User canceled the transaction');
        return;
      }

      if (purchaseResponseCode !== InAppPurchases.IAPResponseCode.OK) {
        throw new Error('Purchase failed');
      }

      // Handle successful purchase
      if (purchaseResults && purchaseResults[0]) {
        const purchase = purchaseResults[0];
        
        // Verify the purchase
        if (!purchase.acknowledged) {
          await InAppPurchases.finishTransactionAsync(purchase, true);
        }
        
        // Update user's subscription status
        await updateUserSubscription(purchase);
      }

    } catch (error) {
      console.error('Purchase error:', error);
      Alert.alert(
        'Purchase Error',
        error instanceof Error ? error.message : 'Failed to process purchase. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  const updateUserSubscription = async (purchase: InAppPurchases.IAPPurchase) => {
    try {
      // Verify receipt with your backend
      // const response = await api.verifyPurchase({
      //   receipt: purchase.transactionReceipt,
      //   productId: purchase.productId
      // });
      
      Alert.alert('Success', 'Thank you for subscribing!');
    } catch (error) {
      console.error('Verification error:', error);
      Alert.alert('Error', 'Failed to verify purchase. Please contact support.');
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

        <Pressable 
          style={[styles.subscribeButton, loading && styles.subscribeButtonDisabled]}
          onPress={() => handlePurchase(QUARTERLY_SUB)}
          disabled={loading}
        >
          <View style={styles.buttonContent}>
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <ThemedText style={styles.subscribeText}>Subscribe - $10 Per Quarter</ThemedText>
            )}
          </View>
        </Pressable>

        <Pressable 
          style={[styles.subscribeButton, loading && styles.subscribeButtonDisabled]}
          onPress={() => handlePurchase(YEARLY_SUB)}
          disabled={loading}
        >
          <View style={styles.buttonContent}>
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <ThemedText style={styles.subscribeText}>Subscribe - $30 Per Year</ThemedText>
            )}
          </View>
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
}); 