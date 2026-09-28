#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>
#import <Foundation/Foundation.h>

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
  
  NSUserDefaults *shared = [[NSUserDefaults alloc] initWithSuiteName:@"group.com.memohnsen.meetcal"];
  if (!shared) {
    RCTLogWarn(@"[SavedWidget] Could not access app group");
    return;
  }
  
  [shared setObject:(selectedMeet ?: @"") forKey:@"selectedMeet"];
  
  if (sessionsJson && sessionsJson.length > 0) {
    NSData *data = [sessionsJson dataUsingEncoding:NSUTF8StringEncoding];
    if (data) {
      [shared setObject:data forKey:@"savedSessions"];
      RCTLogInfo(@"[SavedWidget] Saved %lu bytes of session data", (unsigned long)data.length);
    }
  } else {
    [shared removeObjectForKey:@"savedSessions"];
    RCTLogInfo(@"[SavedWidget] Cleared session data");
  }
  
  [shared synchronize];
  RCTLogInfo(@"[SavedWidget] Data saved successfully. Widget will refresh within 15 minutes.");
}

RCT_EXPORT_METHOD(updateDataWidgets:(NSString *)payloadsJson) {
  RCTLogInfo(@"[SavedWidget] updateDataWidgets called: jsonLength=%lu",
             (unsigned long)payloadsJson.length);

  NSUserDefaults *shared = [[NSUserDefaults alloc] initWithSuiteName:@"group.com.memohnsen.meetcal"];
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
    @"qualifyingTotals": @"qualifyingTotalsWidgetData",
    @"standards": @"standardsWidgetData",
    @"intlRankings": @"intlRankingsWidgetData"
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
}

RCT_EXPORT_METHOD(clearSavedWidget) {
  NSUserDefaults *shared = [[NSUserDefaults alloc] initWithSuiteName:@"group.com.memohnsen.meetcal"];
  if (!shared) return;
  
  [shared removeObjectForKey:@"selectedMeet"];
  [shared removeObjectForKey:@"savedSessions"];
  [shared removeObjectForKey:@"qualifyingTotalsWidgetData"];
  [shared removeObjectForKey:@"standardsWidgetData"];
  [shared removeObjectForKey:@"intlRankingsWidgetData"];
  [shared synchronize];
  RCTLogInfo(@"[SavedWidget] Data cleared. Widget will refresh within 15 minutes.");
}

@end
