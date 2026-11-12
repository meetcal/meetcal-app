//
//  MeetCalWidgetReloader.swift
//  MeetCal
//
//  WidgetCenter is Swift-only, so SavedWidgetModule.m reaches it through this
//  class (looked up by its Obj-C name at runtime). Called after every App
//  Group write so the home-screen widgets redraw now instead of on their next
//  scheduled timeline reload.
//
//  Contract (do not rename): Obj-C class `MeetCalWidgetReloader`, class
//  method `reloadAllTimelines`.
//

import Foundation
#if canImport(WidgetKit)
import WidgetKit
#endif

@objc(MeetCalWidgetReloader)
final class MeetCalWidgetReloader: NSObject {
    @objc static func reloadAllTimelines() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        #endif
    }

    @objc(currentWidgetKinds:)
    static func currentWidgetKinds(_ completion: @escaping ([String]?) -> Void) {
        #if canImport(WidgetKit)
        WidgetCenter.shared.getCurrentConfigurations { result in
            switch result {
            case .success(let widgets):
                completion(widgets.map { $0.kind })
            case .failure:
                completion(nil)
            }
        }
        #else
        completion(nil)
        #endif
    }
}
