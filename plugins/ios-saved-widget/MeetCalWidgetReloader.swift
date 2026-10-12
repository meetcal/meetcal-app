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
}
