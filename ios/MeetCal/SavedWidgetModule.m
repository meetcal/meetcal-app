#import <React/RCTBridgeModule.h>

@interface SavedWidgetModule : NSObject <RCTBridgeModule>
@end

@implementation SavedWidgetModule

RCT_EXPORT_MODULE(SavedWidget);

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

RCT_EXPORT_METHOD(updateSavedWidget:(NSString *)selectedMeet 
                  sessionsJson:(NSString *)sessionsJson) {
  NSUserDefaults *shared = [[NSUserDefaults alloc] initWithSuiteName:@"group.com.memohnsen.meetcal"];
  if (!shared) return;
  
  [shared setObject:(selectedMeet ?: @"") forKey:@"selectedMeet"];
  
  if (sessionsJson && sessionsJson.length > 0) {
    NSData *data = [sessionsJson dataUsingEncoding:NSUTF8StringEncoding];
    if (data) {
      [shared setObject:data forKey:@"savedSessions"];
    }
  } else {
    [shared removeObjectForKey:@"savedSessions"];
  }
  
  [shared synchronize];
}

RCT_EXPORT_METHOD(clearSavedWidget) {
  NSUserDefaults *shared = [[NSUserDefaults alloc] initWithSuiteName:@"group.com.memohnsen.meetcal"];
  if (!shared) return;
  
  [shared removeObjectForKey:@"selectedMeet"];
  [shared removeObjectForKey:@"savedSessions"];
  [shared synchronize];
}

@end
