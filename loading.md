# Improving App Loading Flow

## Current Issue
Currently, there's a race condition between hiding the splash screen and checking subscription status, which causes a brief flash of the onboarding screen for subscribed users.

## Solution: Coordinated Initialization Flow
We'll modify the app initialization to ensure subscription status is checked before hiding the splash screen.

### 2. Update `SubscriptionContext.tsx`

```typescript
import { getSimulatedSubscriptionStatus } from '@/config/development';

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Helper function to check subscription status consistently
  const checkEntitlementStatus = async (customerInfo: Purchases.CustomerInfo): Promise<boolean> => {
    // Check for simulated subscription first
    const simulatedStatus = getSimulatedSubscriptionStatus();
    if (simulatedStatus !== null) {
      console.log('Using simulated subscription status:', simulatedStatus);
      return simulatedStatus;
    }

    const hasActiveEntitlement = customerInfo.entitlements.active['Subscriptions'] != null;
    console.log('Checking entitlement status:', {
      hasActiveEntitlement,
      activeEntitlements: customerInfo.entitlements.active,
      allEntitlements: customerInfo.entitlements
    });
    return hasActiveEntitlement;
  };

  // Rest of the provider remains the same...
}
```

### 3. Modify `app/_layout.tsx`

```typescript
export default function RootLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [fontsLoaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    async function prepare() {
      try {
        // 1. Initialize RevenueCat first
        if (Platform.OS === 'ios') {
          await Purchases.configure({ apiKey: 'appl_UriFuFjiRHwcmgkTgoAgENezgcv' });
        } else if (Platform.OS === 'android') {
          await Purchases.configure({ 
            apiKey: 'goog_tUXAGSdnOuHiTVFNSvQKHxNTbpI',
            appUserID: null,
          });
        }

        // 2. Check subscription status immediately after RevenueCat init
        const customerInfo = await Purchases.getCustomerInfo();
        const hasActiveEntitlement = await checkEntitlementStatus(customerInfo);
        
        // 3. Store subscription status in AsyncStorage for future reference
        await AsyncStorage.setItem('subscriptionStatus', hasActiveEntitlement.toString());

        // 4. Optional: Add a small delay for smoother transition
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.warn('Initialization error:', e);
        // On error, we'll still proceed but may need to check subscription status later
      } finally {
        setAppIsReady(true);
      }
    }

    prepare();
  }, []);

  const onLayoutRootView = useCallback(async () => {
    if (appIsReady && fontsLoaded) {
      await SplashScreen.hideAsync();
    }
  }, [appIsReady, fontsLoaded]);

  if (!appIsReady || !fontsLoaded) {
    return null;
  }

  return (
    <SubscriptionProvider>
      <CustomThemeProvider>
        <SavedSessionsProvider>
          <SelectedMeetProvider>
            <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
              <AppContent />
            </View>
          </SelectedMeetProvider>
        </SavedSessionsProvider>
      </CustomThemeProvider>
    </SubscriptionProvider>
  );
}
```

## Key Changes and Benefits

1. **Development Configuration**
   - Centralized development flags in `config/development.ts`
   - Easy to toggle subscription status for testing
   - Clear separation between development and production code

2. **RevenueCat Integration**
   - Still initializes and checks RevenueCat normally
   - Development config only overrides the final status
   - Maintains normal RevenueCat flow for testing purchases

3. **Coordinated Loading**
   - Splash screen remains visible until both:
     - Fonts are loaded
     - Initial subscription check is complete
   - No more race conditions or screen flashes

4. **Improved Error Handling**
   - If RevenueCat fails, app still loads
   - Uses AsyncStorage as fallback for subscription status
   - Clear separation of concerns between initialization and runtime checks

## Testing Different Scenarios

1. **Testing as Subscribed User**
   - Set `SIMULATE_ACTIVE_SUBSCRIPTION = true` in development config
   - App will bypass onboarding and go straight to main content
   - RevenueCat still initializes normally

2. **Testing as Non-Subscribed User**
   - Set `SIMULATE_ACTIVE_SUBSCRIPTION = false` in development config
   - App will show onboarding flow
   - Can test subscription purchase flow

3. **Testing Real RevenueCat Integration**
   - Comment out or remove `SIMULATE_ACTIVE_SUBSCRIPTION` flag
   - App will use actual RevenueCat subscription status
   - Useful for final testing before production

## Implementation Steps

1. Create `config/development.ts` file
2. Update `SubscriptionContext.tsx` to use development config
3. Modify `app/_layout.tsx` for coordinated initialization
4. Test different subscription scenarios by toggling the config flag

## Testing Checklist

- [ ] App loads with splash screen
- [ ] Subscribed users go directly to main content
- [ ] Unsubscribed users go to onboarding
- [ ] No visual flashes or flickers during load
- [ ] App handles offline state gracefully
- [ ] Error states are handled properly
- [ ] Development config correctly overrides subscription status
- [ ] RevenueCat still initializes and functions normally

## Notes

- The 500ms delay in `prepare()` is optional and can be adjusted or removed
- Consider adding loading states for offline scenarios
- Monitor RevenueCat initialization time in production
- Consider adding analytics to track loading performance
- Development config makes it easy to test different scenarios
- Make sure to disable development overrides before production builds 