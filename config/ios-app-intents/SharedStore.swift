//
//  SharedStore.swift
//  MeetCal App Intents
//
//  Reads the App Group UserDefaults that the RN app (via SavedWidgetModule)
//  mirrors for the WidgetKit extension. Codable payload models live in
//  MeetCalSharedModels.swift, which is compiled into both the main app target
//  and the SavedWidget extension.
//

import Foundation

enum SharedStore {
    static let appGroupIdentifier = "group.com.memohnsen.meetcal"

    static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroupIdentifier) ?? .standard
    }

    // MARK: - Keys

    enum Key {
        static let selectedMeet = "selectedMeet"
        static let savedSessions = "savedSessions"
        static let qualifyingTotals = "qualifyingTotalsWidgetData"
        static let standards = "standardsWidgetData"
        static let intlRankings = "intlRankingsWidgetData"
    }

    // MARK: - Reads

    static var selectedMeet: String {
        defaults.string(forKey: Key.selectedMeet) ?? ""
    }

    /// Saved sessions mirrored from the app. Past sessions are filtered out to
    /// match the widget's behaviour.
    static func savedSessions() -> [SharedSavedSession] {
        guard let data = defaults.data(forKey: Key.savedSessions) else { return [] }
        guard let rows = try? JSONDecoder().decode([SharedSavedSessionRow].self, from: data) else {
            return []
        }
        return rows
            .map { SharedSavedSession(row: $0) }
            .filter { !$0.isPast }
    }

    static func qualifyingTotalsPayload() -> SharedDataPayload? {
        decodePayload(forKey: Key.qualifyingTotals)
    }

    static func standardsPayload() -> SharedDataPayload? {
        decodePayload(forKey: Key.standards)
    }

    static func intlRankingsPayload() -> SharedDataPayload? {
        decodePayload(forKey: Key.intlRankings)
    }

    private static func decodePayload(forKey key: String) -> SharedDataPayload? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(SharedDataPayload.self, from: data)
    }
}
