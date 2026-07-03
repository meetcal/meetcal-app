//
//  MeetCalSharedModels.swift
//  Shared by the MeetCal app target and SavedWidget extension.
//
//  These models mirror the App Group payloads written by SavedWidgetModule.
//

import Foundation

struct MeetCalSharedSavedSessionRow: Codable {
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

struct MeetCalSharedSavedSession: Codable {
    let id: String?
    let meet: String?
    let platform: String
    let sessionNumber: Int
    let startTime: String
    let weighInTime: String?
    let weightClass: String
    let date: String
    let url: String?

    init(
        id: String? = nil,
        meet: String? = nil,
        platform: String,
        sessionNumber: Int,
        startTime: String,
        weighInTime: String? = nil,
        weightClass: String,
        date: String,
        url: String? = nil
    ) {
        self.id = id
        self.meet = meet
        self.platform = platform
        self.sessionNumber = sessionNumber
        self.startTime = startTime
        self.weighInTime = weighInTime
        self.weightClass = weightClass
        self.date = date
        self.url = url
    }

    init(row: MeetCalSharedSavedSessionRow) {
        self.init(
            id: row.id,
            meet: row.meet,
            platform: row.platform,
            sessionNumber: row.session_number,
            startTime: row.start_time,
            weighInTime: row.weigh_in_time,
            weightClass: row.weight_class,
            date: row.date,
            url: row.url
        )
    }

    var stableID: String {
        id ?? "\(meet ?? "")|\(sessionNumber)|\(platform)|\(date)"
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
