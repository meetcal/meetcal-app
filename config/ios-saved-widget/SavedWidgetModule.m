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

RCT_EXPORT_METHOD(clearSavedWidget) {
  NSUserDefaults *shared = [[NSUserDefaults alloc] initWithSuiteName:@"group.com.memohnsen.meetcal"];
  if (!shared) return;
  
  [shared removeObjectForKey:@"selectedMeet"];
  [shared removeObjectForKey:@"savedSessions"];
  [shared synchronize];
  RCTLogInfo(@"[SavedWidget] Data cleared. Widget will refresh within 15 minutes.");
}

@end
