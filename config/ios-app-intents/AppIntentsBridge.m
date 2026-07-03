//
//  AppIntentsBridge.m
//  MeetCal App Intents
//
//  Exports the Swift `AppIntentsBridge` class to React Native.
//  Module name and method name are a contract with the JS layer:
//    NativeModules.AppIntentsBridge.reindexAppEntities()
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AppIntentsBridge, NSObject)

RCT_EXTERN_METHOD(reindexAppEntities:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
