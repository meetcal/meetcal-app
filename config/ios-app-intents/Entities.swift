//
//  Entities.swift
//  MeetCal App Intents
//
//  AppEntity types surfaced to Siri / Shortcuts / Spotlight. Deep-link URLs
//  match exactly what the widget builds (scheme `meetcal://`, see
//  targets/SavedWidget/SavedWidget.swift `sessionDeepLink` and
//  utils/deepLinks.ts).
//

import Foundation
import AppIntents

// MARK: - Deep links

enum MeetCalDeepLinks {
    static let scheme = "meetcal"

    static let saved = URL(string: "meetcal:///open/saved")!
    static let qualifyingTotals = URL(string: "meetcal:///comp-data/new-qualifying-totals")!
    static let standards = URL(string: "meetcal:///comp-data/new-standards")!
    static let rankings = URL(string: "meetcal:///comp-data/rankings")!
    static let records = URL(string: "meetcal:///comp-data/records")!

    /// Mirrors the widget's `sessionDeepLink(...)`:
    /// `meetcal:///shared-screens/schedule-details?...`
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

// MARK: - CompDataDestination

enum CompDataDestination: String, AppEnum {
    case qualifyingTotals
    case standards
    case rankings
    case records

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Competition Data")

    static var caseDisplayRepresentations: [CompDataDestination: DisplayRepresentation] = [
        .qualifyingTotals: "Qualifying Totals",
        .standards: "A/B Standards",
        .rankings: "International Rankings",
        .records: "Records",
    ]

    var title: String {
        switch self {
        case .qualifyingTotals:
            return "Qualifying Totals"
        case .standards:
            return "A/B Standards"
        case .rankings:
            return "International Rankings"
        case .records:
            return "Records"
        }
    }

    var url: URL {
        switch self {
        case .qualifyingTotals:
            return MeetCalDeepLinks.qualifyingTotals
        case .standards:
            return MeetCalDeepLinks.standards
        case .rankings:
            return MeetCalDeepLinks.rankings
        case .records:
            return MeetCalDeepLinks.records
        }
    }
}

// MARK: - Competition data filters

/// Gender filter for competition-data intents. Fixed set so Siri / the
/// Shortcuts action can offer a picker. `apiValue` matches the API's strings.
enum IntentGender: String, AppEnum {
    case men
    case women

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Gender")

    static var caseDisplayRepresentations: [IntentGender: DisplayRepresentation] = [
        .men: "Men",
        .women: "Women",
    ]

    var apiValue: String {
        switch self {
        case .men: return "Men"
        case .women: return "Women"
        }
    }
}

/// Age-category filter. Curated to the common USAW categories; `apiValue`
/// matches the API's strings (compared case-insensitively at filter time).
enum IntentAgeCategory: String, AppEnum {
    case youth
    case junior
    case senior
    case masters
    case university
    case u15
    case u17
    case u20
    case u23

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Age Category")

    static var caseDisplayRepresentations: [IntentAgeCategory: DisplayRepresentation] = [
        .youth: "Youth",
        .junior: "Junior",
        .senior: "Senior",
        .masters: "Masters",
        .university: "University",
        .u15: "U15",
        .u17: "U17",
        .u20: "U20",
        .u23: "U23",
    ]

    var apiValue: String {
        switch self {
        case .youth: return "Youth"
        case .junior: return "Junior"
        case .senior: return "Senior"
        case .masters: return "Masters"
        case .university: return "University"
        case .u15: return "U15"
        case .u17: return "U17"
        case .u20: return "U20"
        case .u23: return "U23"
        }
    }
}

/// Applied competition-data filters. Any `nil` field means "don't constrain".
struct CompDataFilters {
    var gender: String? = nil
    var ageCategory: String? = nil
    var weightClass: String? = nil
    var event: String? = nil
    var recordType: String? = nil
    var meet: String? = nil

    var isEmpty: Bool {
        gender == nil && ageCategory == nil && weightClass == nil
            && event == nil && recordType == nil && meet == nil
    }
}

// MARK: - MeetEntity

struct MeetEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Meet")
    static var defaultQuery = MeetQuery()

    var id: String
    var name: String
    var dates: String
    var location: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(name)",
            subtitle: "\(dates)\(location.isEmpty ? "" : " • \(location)")"
        )
    }

    init(id: String, name: String, dates: String, location: String) {
        self.id = id
        self.name = name
        self.dates = dates
        self.location = location
    }

    init(api meet: APIMeet) {
        self.id = meet.id ?? meet.name
        self.name = meet.name
        self.dates = meet.datesLine
        self.location = meet.locationLine
    }
}

// MARK: - AthleteEntity

struct AthleteEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Athlete")
    static var defaultQuery = AthleteQuery()

    var id: String
    var name: String
    var club: String?
    var weightClass: String?
    var sessionNumber: Int?
    var platform: String?

    var displayRepresentation: DisplayRepresentation {
        var parts: [String] = []
        if let weightClass, !weightClass.isEmpty { parts.append(weightClass) }
        if let club, !club.isEmpty { parts.append(club) }
        if let sessionNumber, let platform {
            parts.append("Session \(sessionNumber) • \(platform)")
        }
        return DisplayRepresentation(
            title: "\(name)",
            subtitle: parts.isEmpty ? nil : "\(parts.joined(separator: " • "))"
        )
    }

    init(id: String, name: String, club: String?, weightClass: String?, sessionNumber: Int?, platform: String?) {
        self.id = id
        self.name = name
        self.club = club
        self.weightClass = weightClass
        self.sessionNumber = sessionNumber
        self.platform = platform
    }

    init(api athlete: APIAthlete) {
        self.id = athlete.member_id ?? athlete.name
        self.name = athlete.name
        self.club = athlete.club
        self.weightClass = athlete.weight_class
        self.sessionNumber = athlete.session_number
        self.platform = athlete.session_platform
    }
}

// MARK: - SessionEntity

struct SessionEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Session")
    static var defaultQuery = SessionQuery()

    var id: String
    var meet: String
    var sessionNumber: Int
    var platform: String
    var weightClass: String?
    var startTime: String?
    var weighInTime: String?
    var date: String?

    var deepLinkURL: URL? {
        MeetCalDeepLinks.sessionDetails(
            id: id,
            meet: meet,
            sessionNumber: sessionNumber,
            platform: platform,
            weightClass: weightClass,
            startTime: startTime,
            weighInTime: weighInTime,
            date: date
        )
    }

    var displayRepresentation: DisplayRepresentation {
        var subtitleParts: [String] = [platform]
        if let startTime, !startTime.isEmpty { subtitleParts.append(startTime) }
        if let weightClass, !weightClass.isEmpty { subtitleParts.append(weightClass) }
        return DisplayRepresentation(
            title: "Session \(sessionNumber)",
            subtitle: "\(subtitleParts.joined(separator: " • "))"
        )
    }
}

// MARK: - SavedSessionEntity

struct SavedSessionEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Saved Session")
    static var defaultQuery = SavedSessionQuery()

    var id: String
    var meet: String
    var sessionNumber: Int
    var platform: String
    var weightClass: String
    var startTime: String
    var weighInTime: String?
    var date: String
    var url: String?

    var deepLinkURL: URL? {
        if let url, let parsed = URL(string: url) { return parsed }
        return MeetCalDeepLinks.sessionDetails(
            id: id,
            meet: meet,
            sessionNumber: sessionNumber,
            platform: platform,
            weightClass: weightClass,
            startTime: startTime,
            weighInTime: weighInTime,
            date: date
        )
    }

    var displayRepresentation: DisplayRepresentation {
        var subtitleParts: [String] = [platform]
        if !weightClass.isEmpty { subtitleParts.append(weightClass) }
        return DisplayRepresentation(
            title: "Session \(sessionNumber)",
            subtitle: "\(subtitleParts.joined(separator: " • "))"
        )
    }

    init(shared session: SharedSavedSession, fallbackMeet: String) {
        self.id = session.stableID
        self.meet = session.meet ?? fallbackMeet
        self.sessionNumber = session.sessionNumber
        self.platform = session.platform
        self.weightClass = session.weightClass
        self.startTime = session.startTime
        self.weighInTime = session.weighInTime
        self.date = session.date
        self.url = session.url
    }
}

// MARK: - CompDataRowEntity

struct CompDataRowEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Competition Data Row")
    static var defaultQuery = CompDataRowQuery()

    var id: String
    var category: String
    var leading: String
    var title: String
    var subtitle: String?
    var trailing: String?

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(title.isEmpty ? leading : title)",
            subtitle: "\(subtitle ?? trailing ?? category)"
        )
    }
}
