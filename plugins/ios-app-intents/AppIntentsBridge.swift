//
//  AppIntentsBridge.swift
//  MeetCal App Intents
//
//  React Native bridge. Exposes a single promise-based method,
//  `reindexAppEntities`, which the JS layer calls
//  (`NativeModules.AppIntentsBridge.reindexAppEntities()`) after saved sessions
//  or the selected meet change, to (re)donate entities to the Spotlight index.
//
//  Contract (do not rename): module `AppIntentsBridge`, method
//  `reindexAppEntities`.
//

import Foundation
// `RCTPromiseResolveBlock` / `RCTPromiseRejectBlock` are declared in React's
// Obj-C headers. The generated Expo bridging header does not import them, so
// pull them in via the `React` Swift module (same as the generated
// AppDelegate.swift). Guarded so the file still parses if React is absent.
#if canImport(React)
import React
#endif

@objc(AppIntentsBridge)
class AppIntentsBridge: NSObject {

    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }

    @objc(reindexAppEntities:rejecter:)
    func reindexAppEntities(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // Spotlight app-entity donation requires the iOS 18 App Intents index.
        // On anything older (or when indexing is unavailable, e.g. simulator),
        // resolve as a no-op so JS callers never reject.
        if #available(iOS 18, *) {
            Task {
                await SemanticIndexDonator.donateAll()
                resolve(nil)
            }
        } else {
            resolve(nil)
        }
    }
}
