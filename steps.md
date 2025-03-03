# Android Compatibility Issues

## Critical (Will Prevent Build/Cause Crashes)
2. Missing `invokeDefaultOnBackPressed` Method in MainActivity.kt
   - Current: Method declaration is missing
   - Fix: Add complete method implementation:
   ```kotlin
   override fun invokeDefaultOnBackPressed() {
     if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
       if (!moveTaskToBack(false)) {
         super.invokeDefaultOnBackPressed()
       }
       return
     }
     super.invokeDefaultOnBackPressed()
   }
   ```

## High Priority (Major Functionality Issues)
3. Calendar Implementation Differences
   - Issue: iOS uses `getDefaultCalendarAsync()` while Android needs explicit calendar selection
   - Location: app/(tabs)/start-list.tsx
   - Fix: Implement more robust calendar fallbacks for Android and better error handling

5. Subscription Management Deep Linking
   - Issue: iOS-specific subscription management URLs
   - Location: app/(screens)/subscription.tsx
   - Fix: Implement proper Android-specific subscription management deep linking
   - Impact: Suboptimal subscription management experience on Android

## Low Priority (Visual Polish)
6. iOS-Specific Blur Effect
   - Issue: Using iOS-specific BlurView component
   - Location: components/ui/TabBarBackground.ios.tsx
   - Fix: Create an Android-specific tab bar background component
   - Impact: Visual inconsistency in tab bar appearance
