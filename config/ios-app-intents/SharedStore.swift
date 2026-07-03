//
//  SharedStore.swift
//  MeetCal App Intents
//
//  Reads the App Group UserDefaults that the RN app (via SavedWidgetModule)
//  mirrors for the WidgetKit extension. The Codable payloads here are
//  intentionally DUPLICATED from targets/SavedWidget/SavedWidget.swift (under
//  distinct names) so the two targets stay decoupled for v1.
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

// MARK: - Codable models (duplicated from the widget target)

/// Raw JSON row as written by SavedWidgetModule (`savedSessions` key).
struct SharedSavedSessionRow: Codable {
    let id: String?
    let meet: String?
    let platform: String
    let session_number: Int
    let start_time: String
    let weigh_in_time: String?
    let weight_class: String
    let date: String
    let url: String?
}

/// A friendlier value type used by the entities/intents.
struct SharedSavedSession {
    let id: String
    let meet: String?
    let platform: String
    let sessionNumber: Int
    let startTime: String
    let weighInTime: String?
    let weightClass: String
    let date: String
    let url: String?

    init(row: SharedSavedSessionRow) {
        // Deterministic identifier so Spotlight donation + query lookups are stable.
        self.id = row.id ?? "\(row.meet ?? "")|\(row.session_number)|\(row.platform)|\(row.date)"
        self.meet = row.meet
        self.platform = row.platform
        self.sessionNumber = row.session_number
        self.startTime = row.start_time
        self.weighInTime = row.weigh_in_time
        self.weightClass = row.weight_class
        self.date = row.date
        self.url = row.url
    }

    var formattedStartTime: String {
        let inputFormatter = DateFormatter()
        inputFormatter.dateFormat = "HH:mm:ss"
        inputFormatter.locale = Locale(identifier: "en_US_POSIX")

        let outputFormatter = DateFormatter()
        outputFormatter.dateStyle = .none
        outputFormatter.timeStyle = .short
        outputFormatter.locale = Locale(identifier: "en_US")

        if let time = inputFormatter.date(from: startTime) {
            return outputFormatter.string(from: time)
        }
        return startTime
    }

    var sessionDateTime: Date? {
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        guard let sessionDate = dateFormatter.date(from: date) else { return nil }

        let timeFormatter = DateFormatter()
        timeFormatter.dateFormat = "HH:mm:ss"
        timeFormatter.locale = Locale(identifier: "en_US_POSIX")
        guard let timeDate = timeFormatter.date(from: startTime) else { return nil }

        let calendar = Calendar.current
        let dateComponents = calendar.dateComponents([.year, .month, .day], from: sessionDate)
        let timeComponents = calendar.dateComponents([.hour, .minute, .second], from: timeDate)

        var combined = DateComponents()
        combined.year = dateComponents.year
        combined.month = dateComponents.month
        combined.day = dateComponents.day
        combined.hour = timeComponents.hour
        combined.minute = timeComponents.minute
        combined.second = timeComponents.second

        return calendar.date(from: combined)
    }

    var isPast: Bool {
        guard let sessionDateTime = sessionDateTime else { return false }
        return sessionDateTime < Date()
    }
}

/// Duplicated from the widget's `DataWidgetRow`.
struct SharedDataRow: Codable, Hashable {
    let leading: String
    let title: String
    let trailing: String
    let subtitle: String?
}

/// Duplicated from the widget's `DataWidgetPayload`.
struct SharedDataPayload: Codable {
    let title: String
    let subtitle: String
    let emptyMessage: String
    let linkURL: String?
    let maxRows: Int?
    let rows: [SharedDataRow]
}
