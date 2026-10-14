#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>
#import <Foundation/Foundation.h>

// The App Group id and keys are a contract with the widget extension and the
// App Intents (`MeetCalShared` in MeetCalSharedModels.swift) and with JS
// (src/utils/widgetContract.ts). Obj-C cannot read the Swift constants, so
// they are repeated here; src/utils/widgetContract.test.ts checks they agree.
static NSString *const MeetCalAppGroupIdentifier = @"group.com.memohnsen.meetcal";
static NSString *const MeetCalSelectedMeetKey = @"selectedMeet";
static NSString *const MeetCalSavedSessionsKey = @"savedSessions";
static NSString *const MeetCalQualifyingTotalsKey = @"qualifyingTotalsWidgetData";
static NSString *const MeetCalStandardsKey = @"standardsWidgetData";
static NSString *const MeetCalIntlRankingsKey = @"intlRankingsWidgetData";
static NSString *const MeetCalEntitlementHintKey = @"premiumEntitlementHint";

// `MeetCalWidgetReloader` (MeetCalWidgetReloader.swift) wraps WidgetCenter,
// which is Swift-only. Looked up at runtime so this file does not depend on
// the generated `<Product>-Swift.h` header name.
@protocol MeetCalWidgetReloading
+ (void)reloadAllTimelines;
@end

static void MeetCalReloadWidgetTimelines(void) {
  Class reloader = NSClassFromString(@"MeetCalWidgetReloader");
  if (reloader && [reloader respondsToSelector:@selector(reloadAllTimelines)]) {
    [(Class<MeetCalWidgetReloading>)reloader reloadAllTimelines];
  } else {
    RCTLogWarn(@"[SavedWidget] MeetCalWidgetReloader unavailable; widgets refresh on their own schedule");
  }
}

@interface SavedWidgetModule : NSObject <RCTBridgeModule>
@end

@implementation SavedWidgetModule

RCT_EXPORT_MODULE(SavedWidget);

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_EXPORT_METHOD(updateSavedWidget:(NSString *)selectedMeet
                  sessionsJson:(NSString *)sessionsJson) {
  RCTLogInfo(@"[SavedWidget] updateSavedWidget called: meet=%@, jsonLength=%lu",
             selectedMeet, (unsigned long)sessionsJson.length);

  NSUserDefaults *shared = [[NSUserDefaults alloc] initWithSuiteName:MeetCalAppGroupIdentifier];
  if (!shared) {
    RCTLogWarn(@"[SavedWidget] Could not access app group");
    return;
  }

  [shared setObject:(selectedMeet ?: @"") forKey:MeetCalSelectedMeetKey];

  if (sessionsJson && sessionsJson.length > 0) {
    NSData *data = [sessionsJson dataUsingEncoding:NSUTF8StringEncoding];
    if (data) {
      [shared setObject:data forKey:MeetCalSavedSessionsKey];
      RCTLogInfo(@"[SavedWidget] Saved %lu bytes of session data", (unsigned long)data.length);
    }
  } else {
    [shared removeObjectForKey:MeetCalSavedSessionsKey];
    RCTLogInfo(@"[SavedWidget] Cleared session data");
  }

  [shared synchronize];
  MeetCalReloadWidgetTimelines();
}

RCT_EXPORT_METHOD(updateDataWidgets:(NSString *)payloadsJson) {
  RCTLogInfo(@"[SavedWidget] updateDataWidgets called: jsonLength=%lu",
             (unsigned long)payloadsJson.length);

  NSUserDefaults *shared = [[NSUserDefaults alloc] initWithSuiteName:MeetCalAppGroupIdentifier];
  if (!shared) {
    RCTLogWarn(@"[SavedWidget] Could not access app group");
    return;
  }

  NSData *jsonData = [payloadsJson dataUsingEncoding:NSUTF8StringEncoding];
  if (!jsonData) {
    RCTLogWarn(@"[SavedWidget] Could not encode data widget payloads");
    return;
  }

  NSError *error = nil;
  NSDictionary *payloads = [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:&error];
  if (error || ![payloads isKindOfClass:[NSDictionary class]]) {
    RCTLogWarn(@"[SavedWidget] Invalid data widget payloads: %@", error);
    return;
  }

  NSDictionary *keyMap = @{
    @"qualifyingTotals": MeetCalQualifyingTotalsKey,
    @"standards": MeetCalStandardsKey,
    @"intlRankings": MeetCalIntlRankingsKey
  };

  [keyMap enumerateKeysAndObjectsUsingBlock:^(NSString *payloadKey, NSString *defaultsKey, BOOL *stop) {
    id payload = payloads[payloadKey];
    if (!payload || payload == [NSNull null]) {
      [shared removeObjectForKey:defaultsKey];
      return;
    }

    NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
    if (data) {
      [shared setObject:data forKey:defaultsKey];
      RCTLogInfo(@"[SavedWidget] Saved %@ payload (%lu bytes)", payloadKey, (unsigned long)data.length);
    }
  }];

  [shared synchronize];
  MeetCalReloadWidgetTimelines();
}

// The app's last known premium entitlement, read by the App Intents
// (`MeetCalShared.hasPremiumEntitlementHint`) so Siri gates premium answers
// the way the app does. JS writes it only once RevenueCat (or its cache) has
// answered; an absent key reads as not subscribed. No widget reads it: the
// data widgets get "subscribe" payloads from JS instead.
RCT_EXPORT_METHOD(updateEntitlementHint:(BOOL)isSubscribed) {
  NSUserDefaults *shared = [[NSUserDefaults alloc] initWithSuiteName:MeetCalAppGroupIdentifier];
  if (!shared) {
    RCTLogWarn(@"[SavedWidget] Could not access app group");
    return;
  }

  [shared setBool:isSubscribed forKey:MeetCalEntitlementHintKey];
  [shared synchronize];
}

// Clears only the saved-sessions widget (the signed-in user's data). The data
// widget payloads are public reference data, need no sign-in, and are only
// rewritten when the app refreshes them, so sign-out leaves them in place.
RCT_EXPORT_METHOD(clearSavedWidget) {
  NSUserDefaults *shared = [[NSUserDefaults alloc] initWithSuiteName:MeetCalAppGroupIdentifier];
  if (!shared) return;

  [shared removeObjectForKey:MeetCalSelectedMeetKey];
  [shared removeObjectForKey:MeetCalSavedSessionsKey];
  [shared synchronize];
  RCTLogInfo(@"[SavedWidget] Saved-session data cleared.");
  MeetCalReloadWidgetTimelines();
}

@end
