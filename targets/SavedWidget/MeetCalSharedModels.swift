//
//  MeetCalSharedModels.swift
//  Shared by the MeetCal app target and SavedWidget extension.
//
//  These models mirror the App Group payloads written by SavedWidgetModule.
//  The JS side of the contract is src/utils/widgetContract.ts, and
//  src/utils/widgetContract.test.ts reads this file: a field or key changed
//  here must change there too.
//

import Foundation

// MARK: - App Group contract

enum MeetCalShared {
    /// `WIDGET_APP_GROUP_ID` in src/utils/widgetContract.ts. Also a literal in
    /// SavedWidgetModule.m and the entitlements (Obj-C and plists cannot read
    /// this constant); the contract test checks they agree.
    static let appGroupIdentifier = "group.com.memohnsen.meetcal"

    static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroupIdentifier) ?? .standard
    }

    /// `WIDGET_STORAGE_KEYS` in src/utils/widgetContract.ts.
    enum Key {
        static let selectedMeet = "selectedMeet"
        static let savedSessions = "savedSessions"
        static let qualifyingTotals = "qualifyingTotalsWidgetData"
        static let standards = "standardsWidgetData"
        static let intlRankings = "intlRankingsWidgetData"
    }

    static func selectedMeet(in defaults: UserDefaults = MeetCalShared.defaults) -> String {
        defaults.string(forKey: Key.selectedMeet) ?? ""
    }

    /// Every mirrored saved session, in the order the app sent them
    /// (chronological), including ones that have already started.
    static func allSavedSessions(in defaults: UserDefaults = MeetCalShared.defaults) -> [MeetCalSharedSavedSession] {
        guard let data = defaults.data(forKey: Key.savedSessions),
              let rows = try? JSONDecoder().decode([MeetCalSharedSavedSessionRow].self, from: data) else {
            return []
        }
        return rows.map { MeetCalSharedSavedSession(row: $0) }
    }

    /// Saved sessions that have not started at `now`. The widget and the
    /// intents both read through this, so they always agree.
    static func upcomingSavedSessions(
        in defaults: UserDefaults = MeetCalShared.defaults,
        at now: Date = Date()
    ) -> [MeetCalSharedSavedSession] {
        allSavedSessions(in: defaults).filter { !$0.hasStarted(at: now) }
    }

    static func dataPayload(forKey key: String, in defaults: UserDefaults = MeetCalShared.defaults) -> MeetCalSharedDataPayload? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(MeetCalSharedDataPayload.self, from: data)
    }
}

// MARK: - Deep links

/// meetcal:// links shared by the widget and the App Intents. They match
/// src/utils/deepLinks.ts.
enum MeetCalDeepLinks {
    static let scheme = "meetcal"

    static let saved = URL(string: "meetcal:///open/saved")!
    static let qualifyingTotals = URL(string: "meetcal:///comp-data/new-qualifying-totals")!
    static let standards = URL(string: "meetcal:///comp-data/new-standards")!
    static let rankings = URL(string: "meetcal:///comp-data/rankings")!
    static let records = URL(string: "meetcal:///comp-data/records")!

    /// `meetcal:///shared-screens/schedule-details?...`, used when a row has
    /// no `url` of its own.
    static func sessionDetails(
        id: String?,
        meet: String?,
        sessionNumber: Int,
        platform: String,
        weightClass: String?,
        startTime: String?,
        weighInTime: String?,
        date: String?
    ) -> URL? {
        var components = URLComponents()
        components.scheme = scheme
        components.host = ""
        components.path = "/shared-screens/schedule-details"
        components.queryItems = [
            URLQueryItem(name: "id", value: id),
            URLQueryItem(name: "meet", value: meet),
            URLQueryItem(name: "sessionNumber", value: String(sessionNumber)),
            URLQueryItem(name: "platform", value: platform),
            URLQueryItem(name: "weightClass", value: weightClass),
            URLQueryItem(name: "startTime", value: startTime),
            URLQueryItem(name: "weighInTime", value: weighInTime),
            URLQueryItem(name: "date", value: date),
        ].filter { item in
            guard let value = item.value else { return false }
            return !value.isEmpty
        }
        return components.url
    }
}

// MARK: - Saved sessions

/// One row as JS writes it (`SAVED_WIDGET_ROW_FIELDS` in
/// src/utils/widgetContract.ts). `start_time` is the meet-local display time
/// ("9:00 AM"); `start_at_ms` is the start instant, absent when the app could
/// not resolve the meet's zone.
struct MeetCalSharedSavedSessionRow: Codable {
    let id: String?
    let meet: String?
    let platform: String
    let session_number: Int
    let start_time: String
    let start_at_ms: Double?
    let weigh_in_time: String?
    let weight_class: String
    let date: String
    let day_label: String?
    let time_zone: String?
    let url: String?
}

struct MeetCalSharedSavedSession: Codable {
    let id: String?
    let meet: String?
    let platform: String
    let sessionNumber: Int
    let startTime: String
    let startAt: Date?
    let weighInTime: String?
    let weightClass: String
    let date: String
    let dayLabel: String?
    let url: String?

    init(
        id: String? = nil,
        meet: String? = nil,
        platform: String,
        sessionNumber: Int,
        startTime: String,
        startAt: Date? = nil,
        weighInTime: String? = nil,
        weightClass: String,
        date: String,
        dayLabel: String? = nil,
        url: String? = nil
    ) {
        self.id = id
        self.meet = meet
        self.platform = platform
        self.sessionNumber = sessionNumber
        self.startTime = startTime
        self.startAt = startAt
        self.weighInTime = weighInTime
        self.weightClass = weightClass
        self.date = date
        self.dayLabel = dayLabel
        self.url = url
    }

    init(row: MeetCalSharedSavedSessionRow) {
        self.init(
            id: row.id,
            meet: row.meet,
            platform: row.platform,
            sessionNumber: row.session_number,
            startTime: row.start_time,
            startAt: row.start_at_ms.map { Date(timeIntervalSince1970: $0 / 1000) },
            weighInTime: row.weigh_in_time,
            weightClass: row.weight_class,
            date: row.date,
            dayLabel: row.day_label,
            url: row.url
        )
    }

    var stableID: String {
        id ?? "\(meet ?? "")|\(sessionNumber)|\(platform)|\(date)"
    }

    /// The meet-local time exactly as the app shows it. Never re-parsed or
    /// re-zoned on device: the meet's wall clock is what the athlete needs.
    var formattedStartTime: String {
        startTime
    }

    /// "Sat, Jun 20 • 89kg": the meet-local day (multi-day meets) and the
    /// weight classes. Just the weight classes when the app sent no day.
    var detailLine: String {
        [dayLabel ?? "", weightClass]
            .filter { !$0.isEmpty }
            .joined(separator: " • ")
    }

    /// True once the start instant has passed. A row without one (unknown
    /// meet zone) is kept rather than guessed at.
    func hasStarted(at now: Date) -> Bool {
        guard let startAt else { return false }
        return startAt <= now
    }

    var isPast: Bool {
        hasStarted(at: Date())
    }
}

// MARK: - Data widgets

struct MeetCalSharedDataRow: Codable, Hashable {
    let leading: String
    let title: String
    let trailing: String
    let subtitle: String?
}

struct MeetCalSharedDataPayload: Codable {
    let title: String
    let subtitle: String
    let emptyMessage: String
    let linkURL: String?
    let maxRows: Int?
    let rows: [MeetCalSharedDataRow]
}

typealias SessionsRowForWidget = MeetCalSharedSavedSessionRow
typealias WidgetSession = MeetCalSharedSavedSession
typealias DataWidgetRow = MeetCalSharedDataRow
typealias DataWidgetPayload = MeetCalSharedDataPayload

typealias SharedSavedSessionRow = MeetCalSharedSavedSessionRow
typealias SharedSavedSession = MeetCalSharedSavedSession
typealias SharedDataRow = MeetCalSharedDataRow
typealias SharedDataPayload = MeetCalSharedDataPayload
