# Adding Lifetime Access Button to MeetCal Pro

## Overview
We'll add a one-time purchase option for lifetime access to MeetCal Pro using RevenueCat's non-consumable in-app purchase functionality.

## Steps

### 1. RevenueCat Dashboard Setup
- Log into RevenueCat dashboard
- Add new product with identifier `lifetime_meetcal_pro`
- Configure as non-consumable product type
- Set up pricing and details in App Store Connect/Google Play Console
- Link the product in RevenueCat dashboard

### 2. Update Product Configuration
- Add lifetime product ID to PRODUCT_IDS constant
- Update type definitions to handle non-subscription packages
- Add new constant for identifying lifetime purchase

```typescript
const PRODUCT_IDS = Platform.select({
  ios: ['quarterly_meetcal', 'yearly_meetcal', 'lifetime_meetcal_pro'],
  android: ['meetcal.pro.monthly', 'meetcal.pro.yearly', 'lifetime_meetcal_pro']
});
```

### 3. Update UI Components
- Add new section for lifetime access button
- Style lifetime button distinctly from subscription options
- Add "Best Value" or similar badge
- Ensure proper spacing and layout

### 4. Implement Purchase Logic
- Update handlePurchase function to handle non-subscription purchases
- Add specific logic for lifetime purchase validation
- Update purchase success handling for lifetime access
- Modify error handling for non-subscription purchases

### 5. Update Subscription Context
- Modify SubscriptionContext to handle lifetime access
- Add new state for lifetime purchase status
- Update subscription checking logic
- Ensure persistence of lifetime access status

### 6. Testing
1. Test purchase flow:
   - New purchase
   - Restore purchase
   - Error handling
2. Test UI in both light and dark mode
3. Test on both iOS and Android
4. Verify persistence after app restart
5. Test alongside existing subscription options

### 7. Update Restore Purchase Logic
- Modify restorePurchases function to check for lifetime purchase
- Update restore success/failure handling
- Ensure proper state updates after restore

### 8. Documentation & Code Cleanup
- Update comments and documentation
- Clean up any console.logs
- Add type safety improvements
- Document testing procedures

## Implementation Order
1. Start with RevenueCat dashboard setup
2. Update product configuration
3. Implement basic UI changes
4. Add purchase logic
5. Update subscription context
6. Implement restore functionality
7. Add final UI polish
8. Conduct thorough testing
9. Clean up and document

## Notes
- Ensure backwards compatibility with existing subscriptions
- Consider migration path for existing subscribers
- Plan for proper error handling and edge cases
- Consider adding analytics for tracking lifetime vs subscription purchases 