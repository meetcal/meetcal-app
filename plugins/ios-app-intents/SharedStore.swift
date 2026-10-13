//
//  SharedStore.swift
//  MeetCal App Intents
//
//  Reads the App Group UserDefaults that the RN app (via SavedWidgetModule)
//  mirrors for the WidgetKit extension. The App Group id, keys, Codable
//  payload models and the decode-and-filter step live in
//  MeetCalSharedModels.swift, which is compiled into both the main app target
//  and the SavedWidget extension, so Siri and the widget read the same way.
//

import Foundation

enum SharedStore {
    static let appGroupIdentifier = MeetCalShared.appGroupIdentifier

    static var defaults: UserDefaults {
        MeetCalShared.defaults
    }

    typealias Key = MeetCalShared.Key

    // MARK: - Reads

    static var selectedMeet: String {
        MeetCalShared.selectedMeet(in: defaults)
    }

    /// Saved sessions mirrored from the app that have not started yet, in
    /// chronological order. Matches the widget.
    static func savedSessions() -> [SharedSavedSession] {
        MeetCalShared.upcomingSavedSessions(in: defaults)
    }

    /// See `MeetCalShared.hasPremiumEntitlementHint`: false unless the app
    /// last saw the premium entitlement.
    static var hasPremiumEntitlement: Bool {
        MeetCalShared.hasPremiumEntitlementHint(in: defaults)
    }

    static func qualifyingTotalsPayload() -> SharedDataPayload? {
        MeetCalShared.dataPayload(forKey: Key.qualifyingTotals, in: defaults)
    }

    static func standardsPayload() -> SharedDataPayload? {
        MeetCalShared.dataPayload(forKey: Key.standards, in: defaults)
    }

    static func intlRankingsPayload() -> SharedDataPayload? {
        MeetCalShared.dataPayload(forKey: Key.intlRankings, in: defaults)
    }
}
