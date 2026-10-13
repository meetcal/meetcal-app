import { useEffect, useEffectEvent } from 'react';
import { AppState } from 'react-native';

import { useSubscription } from '@/contexts/SubscriptionContext';
import { refreshDataWidgets } from '@/lib/data-widgets-refresh';
import { syncPremiumEntitlementHint } from '@/utils/dataWidgets';

/**
 * Keeps the native surfaces outside the React tree in step with the app: the
 * data widgets (refreshed at launch, whenever the app returns to the
 * foreground, and when the premium entitlement changes) and the entitlement
 * hint Siri reads next to them. `refreshDataWidgets` shares one in-flight run
 * and throttles repeats, so mounting this once at the root, inside
 * `SubscriptionProvider`, is all it takes.
 *
 * The entitlement effect runs as soon as RevenueCat (or its cache) answers,
 * so a purchase reaches Siri and the widgets without waiting for the next
 * foreground.
 */
export function useDataWidgetRefresh(): void {
  const { isSubscribed } = useSubscription();

  useEffect(() => {
    syncPremiumEntitlementHint(isSubscribed);
    void refreshDataWidgets(isSubscribed);
  }, [isSubscribed]);

  const onForeground = useEffectEvent(() => {
    void refreshDataWidgets(isSubscribed);
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') onForeground();
    });
    return () => subscription.remove();
  }, []);
}
