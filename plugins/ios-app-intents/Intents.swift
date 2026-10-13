//
//  Intents.swift
//  MeetCal App Intents
//
//  Read-only intents. Data comes either from the App Group mirror (saved
//  sessions, comp-data payloads) or live from MeetCalAPI. "Open" behaviours
//  route through existing meetcal:// deep links.
//

import Foundation
import AppIntents
import SwiftUI

// MARK: - Failure answers

/// What an intent answers when MeetCal's server could not be reached
/// (offline, a timeout, a server error). Kept distinct from "nothing
/// matched", which is what swallowing the error used to make Siri say.
enum IntentFailure {
    static func dialog() -> IntentDialog {
        "MeetCal couldn't reach the server. Check your connection and try again."
    }

    static func view(title: String, systemImage: String) -> SnippetListView {
        SnippetListView(
            title: title,
            subtitle: nil,
            rows: [],
            emptyMessage: "Couldn't reach MeetCal",
            systemImage: systemImage
        )
    }
}

// MARK: - Premium gate

/// The premium answers. In the app each is behind `SubscriptionGate` (the
/// comp-data screens) or `requirePremium` (athlete results); Siri applies the
/// same soft gate from the entitlement hint the app mirrors into the App
/// Group (`SharedStore.hasPremiumEntitlement`).
enum PremiumFeature: String, AppEnum {
    case qualifyingTotals
    case standards
    case rankings
    case records
    case athleteResults

    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Premium Feature")

    static var caseDisplayRepresentations: [PremiumFeature: DisplayRepresentation] = [
        .qualifyingTotals: "Qualifying Totals",
        .standards: "A/B Standards",
        .rankings: "International Rankings",
        .records: "Records",
        .athleteResults: "Athlete Results",
    ]

    var title: String {
        switch self {
        case .qualifyingTotals: return "Qualifying Totals"
        case .standards: return "A/B Standards"
        case .rankings: return "International Rankings"
        case .records: return "Records"
        case .athleteResults: return "Athlete Results"
        }
    }

    /// What the answer would have shown, for "Subscribe in MeetCal to see …".
    var noun: String {
        switch self {
        case .qualifyingTotals: return "qualifying totals"
        case .standards: return "A/B standards"
        case .rankings: return "international rankings"
        case .records: return "records"
        case .athleteResults: return "athlete results"
        }
    }

    var systemImage: String {
        switch self {
        case .qualifyingTotals: return "target"
        case .standards: return "chart.bar"
        case .rankings: return "globe.americas.fill"
        case .records: return "medal.fill"
        case .athleteResults: return "trophy.fill"
        }
    }

    /// Where "Subscribe" goes. A comp-data screen shows the paywall inline
    /// (its `SubscriptionGate`) and the data after a purchase; athlete results
    /// have no screen of their own to land on, so they open the paywall.
    var url: URL {
        switch self {
        case .qualifyingTotals: return MeetCalDeepLinks.qualifyingTotals
        case .standards: return MeetCalDeepLinks.standards
        case .rankings: return MeetCalDeepLinks.rankings
        case .records: return MeetCalDeepLinks.records
        case .athleteResults: return URL(string: "meetcal:///shared-screens/paywall?feature=athlete-results")!
        }
    }
}

enum PremiumGate {
    /// False unless the app last saw the premium entitlement: an absent hint
    /// (the app has not run since updating, or RevenueCat never answered)
    /// fails closed.
    static var isUnlocked: Bool {
        SharedStore.hasPremiumEntitlement
    }

    /// The answer a user without the entitlement gets: no data, and a
    /// Subscribe button that opens MeetCal on the paywall.
    static func lockedAnswer(_ feature: PremiumFeature) -> (IntentDialog, SnippetListView) {
        let message = "Subscribe in MeetCal to see \(feature.noun)."
        let view = SnippetListView(
            title: feature.title,
            subtitle: "Subscription required",
            rows: [],
            emptyMessage: message,
            systemImage: feature.systemImage,
            subscribeFeature: feature
        )
        return ("\(message)", view)
    }
}

/// Opens MeetCal where a premium feature's paywall is. Run from the
/// Subscribe button of a locked answer; not offered on its own.
struct OpenPremiumFeatureIntent: AppIntent {
    static var title: LocalizedStringResource = "Subscribe in MeetCal"
    static var description = IntentDescription("Open MeetCal's subscription screen for a premium feature.")
    static var openAppWhenRun = true
    static var isDiscoverable = false

    @Parameter(title: "Feature")
    var feature: PremiumFeature

    init() {}

    init(feature: PremiumFeature) {
        self.feature = feature
    }

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(feature.url))
    }
}

// MARK: - FindMeetsIntent

struct FindMeetsIntent: AppIntent {
    static var title: LocalizedStringResource = "Find Meets"
    static var description = IntentDescription("Find upcoming weightlifting meets, optionally filtered by a search term.")

    @Parameter(title: "Search", requestValueDialog: "Which meets are you looking for?")
    var searchTerm: String?

    func perform() async throws -> some IntentResult & ReturnsValue<[MeetEntity]> & ProvidesDialog & ShowsSnippetView {
        let apiMeets: [APIMeet]
        do {
            apiMeets = try await MeetCalAPI.shared.meets()
        } catch {
            return .result(
                value: [MeetEntity](),
                dialog: IntentFailure.dialog(),
                view: IntentFailure.view(title: "Meets", systemImage: "calendar")
            )
        }
        var meets = apiMeets.map { MeetEntity(api: $0) }

        if let term = searchTerm?.trimmingCharacters(in: .whitespacesAndNewlines), !term.isEmpty {
            let needle = term.lowercased()
            meets = meets.filter {
                $0.name.lowercased().contains(needle) || $0.location.lowercased().contains(needle)
            }
        }

        let limited = Array(meets.prefix(8))
        let rows = limited.map { SnippetRow(leading: "", title: $0.name, subtitle: "\($0.dates)\($0.location.isEmpty ? "" : " • \($0.location)")") }

        let dialog: IntentDialog
        if meets.isEmpty {
            dialog = "I couldn't find any matching meets."
        } else if let term = searchTerm, !term.isEmpty {
            dialog = "I found \(meets.count) meets matching \(term)."
        } else {
            dialog = "Here are \(meets.count) upcoming meets."
        }

        return .result(
            value: limited,
            dialog: dialog,
            view: SnippetListView(
                title: "Meets",
                subtitle: searchTerm,
                rows: rows,
                emptyMessage: "No meets found",
                systemImage: "calendar"
            )
        )
    }
}

// MARK: - SearchAthleteIntent

struct SearchAthleteIntent: AppIntent {
    static var title: LocalizedStringResource = "Search Athlete"
    static var description = IntentDescription("Search for an athlete and see their session details for the selected meet.")

    @Parameter(title: "Athlete Name", requestValueDialog: "Which athlete?")
    var name: String

    func perform() async throws -> some IntentResult & ReturnsValue<[AthleteEntity]> & ProvidesDialog & ShowsSnippetView {
        let matches: [AthleteEntity]
        do {
            matches = try await AthleteEntity.defaultQuery.entities(matching: name)
        } catch {
            return .result(
                value: [AthleteEntity](),
                dialog: IntentFailure.dialog(),
                view: IntentFailure.view(title: "Athletes", systemImage: "person.fill")
            )
        }
        let limited = Array(matches.prefix(8))

        let rows = limited.map { athlete -> SnippetRow in
            var subtitleParts: [String] = []
            if let wc = athlete.weightClass, !wc.isEmpty { subtitleParts.append(wc) }
            if let club = athlete.club, !club.isEmpty { subtitleParts.append(club) }
            var trailing: String?
            if let session = athlete.sessionNumber, let platform = athlete.platform {
                trailing = "\(session) \(platform)"
            }
            return SnippetRow(
                leading: "",
                title: athlete.name,
                subtitle: subtitleParts.isEmpty ? nil : subtitleParts.joined(separator: " • "),
                trailing: trailing
            )
        }

        let dialog: IntentDialog
        if matches.isEmpty {
            dialog = "I couldn't find an athlete named \(name)."
        } else if let first = matches.first, let session = first.sessionNumber, let platform = first.platform {
            dialog = "\(first.name) is in session \(session) on the \(platform) platform."
        } else {
            dialog = "I found \(matches.count) athletes matching \(name)."
        }

        return .result(
            value: limited,
            dialog: dialog,
            view: SnippetListView(
                title: "Athletes",
                subtitle: name,
                rows: rows,
                emptyMessage: "No athletes found",
                systemImage: "person.fill"
            )
        )
    }
}

// MARK: - GetSessionScheduleIntent

struct GetSessionScheduleIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Session Schedule"
    static var description = IntentDescription("Show the session schedule for a meet.")

    @Parameter(title: "Meet")
    var meet: MeetEntity?

    func perform() async throws -> some IntentResult & ReturnsValue<[SessionEntity]> & ProvidesDialog & ShowsSnippetView {
        let meetName = meet?.name ?? SharedStore.selectedMeet
        guard !meetName.isEmpty else {
            return .result(
                value: [],
                dialog: "Please choose a meet first.",
                view: SnippetListView(title: "Schedule", subtitle: nil, rows: [], emptyMessage: "No meet selected", systemImage: "calendar")
            )
        }

        let sessions: [SessionEntity]
        do {
            sessions = try await SessionQuery.sessions(forMeet: meetName)
        } catch {
            return .result(
                value: [SessionEntity](),
                dialog: IntentFailure.dialog(),
                view: IntentFailure.view(title: meetName, systemImage: "calendar")
            )
        }
        let limited = Array(sessions.prefix(12))
        let rows = limited.map { session -> SnippetRow in
            // The day first: a multi-day meet's sessions otherwise read as one day.
            let subtitleParts = [APIDayFormat.short(session.date), session.weightClass]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
            return SnippetRow(
                leading: session.platform,
                title: "Session \(session.sessionNumber)",
                subtitle: subtitleParts.isEmpty ? nil : subtitleParts.joined(separator: " • "),
                trailing: session.startTime
            )
        }

        let dialog: IntentDialog = sessions.isEmpty
            ? "I couldn't find a schedule for \(meetName)."
            : "\(meetName) has \(sessions.count) sessions."

        return .result(
            value: limited,
            dialog: dialog,
            view: SnippetListView(
                title: meetName,
                subtitle: "Schedule",
                rows: rows,
                emptyMessage: "No sessions found",
                systemImage: "calendar"
            )
        )
    }
}

// MARK: - ShowSavedSessionsIntent

struct ShowSavedSessionsIntent: AppIntent {
    static var title: LocalizedStringResource = "Show Saved Sessions"
    static var description = IntentDescription("Show the sessions you've saved in MeetCal.")

    func perform() async throws -> some IntentResult & ReturnsValue<[SavedSessionEntity]> & ProvidesDialog & ShowsSnippetView {
        let selectedMeet = SharedStore.selectedMeet
        let saved = SharedStore.savedSessions().map {
            SavedSessionEntity(shared: $0, fallbackMeet: selectedMeet)
        }

        let rows = saved.map { session -> SnippetRow in
            var subtitleParts: [String] = []
            if !session.weightClass.isEmpty { subtitleParts.append(session.weightClass) }
            return SnippetRow(
                leading: session.platform,
                title: "Session \(session.sessionNumber)",
                subtitle: subtitleParts.isEmpty ? nil : subtitleParts.joined(separator: " • "),
                trailing: session.startTime
            )
        }

        // Only the meet selected in the app is mirrored, so an empty answer
        // names that meet instead of claiming nothing is saved anywhere.
        let dialog: IntentDialog
        if saved.count == 1 {
            dialog = "You have 1 upcoming saved session."
        } else if !saved.isEmpty {
            dialog = "You have \(saved.count) upcoming saved sessions."
        } else if selectedMeet.isEmpty {
            dialog = "You don't have any upcoming saved sessions. Select a meet in MeetCal to see the sessions you saved for it."
        } else {
            dialog = "You don't have any upcoming saved sessions for \(selectedMeet). To check another meet, select it in MeetCal."
        }

        return .result(
            value: saved,
            dialog: dialog,
            view: SnippetListView(
                title: selectedMeet.isEmpty ? "Saved Sessions" : selectedMeet,
                subtitle: "Saved Sessions",
                rows: rows,
                emptyMessage: "No saved sessions",
                systemImage: "bookmark.fill"
            )
        )
    }
}

// MARK: - GetAthleteResultsIntent

struct GetAthleteResultsIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Athlete Results"
    static var description = IntentDescription("Get an athlete's best lifts and recent competition results.")

    @Parameter(title: "Athlete Name", requestValueDialog: "Whose results do you want?")
    var name: String

    /// Recent meets shown in the snippet; also the per-name fetch bound.
    private static let recentResultCount = 5

    /// The bests cover `HistoryCutoff.yearBestsYears` of results, not a
    /// career, so they are labelled with that window, never as records.
    private static var bestsWindow: String {
        let years = HistoryCutoff.yearBestsYears
        return years == 1 ? "the past year" : "the past \(years) years"
    }

    private static var bestsTitle: String {
        let years = HistoryCutoff.yearBestsYears
        return years == 1 ? "Bests (Past Year)" : "Bests (Past \(years) Years)"
    }

    func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
        guard PremiumGate.isUnlocked else {
            let (dialog, view) = PremiumGate.lockedAnswer(.athleteResults)
            return .result(dialog: dialog, view: view)
        }

        // Bests and recent meets are independent: show whichever arrived.
        async let bestsTask = MeetCalAPI.shared.bests(names: [name])
        async let resultsTask = MeetCalAPI.shared.resultsByNames([name], limitPerName: Self.recentResultCount)
        let fetchedBests = try? await bestsTask
        let fetchedResults = try? await resultsTask
        let bests = fetchedBests ?? [:]
        let results = fetchedResults ?? []
        // `bests(names:)` leaves out a name with no bests, so an unknown name
        // (a typo) has none and reaches "I couldn't find results".
        let best = bests[name] ?? bests.values.first

        var rows: [SnippetRow] = []

        if let best {
            let snatch = positiveKg(best.best_snatch)
            let cj = positiveKg(best.best_cj)
            let total = positiveKg(best.best_total)
            rows.append(SnippetRow(
                leading: "",
                title: Self.bestsTitle,
                subtitle: "Sn \(snatch.map(String.init) ?? "—") • CJ \(cj.map(String.init) ?? "—")",
                trailing: total.map { "\($0) kg" } ?? "—"
            ))
        }

        for result in results.prefix(Self.recentResultCount) {
            let total = positiveKg(result.total.map(Double.init)).map { "\($0) kg" } ?? "—"
            // A body weight sent as 0 is missing, not "0.0 kg BW".
            let bodyWeight = result.body_weight.flatMap { $0 > 0 ? "\(kgString($0)) BW" : nil }
            rows.append(SnippetRow(
                leading: "",
                title: result.meet ?? "Meet",
                subtitle: [result.date.map { APIDateFormat.pretty($0) }, bodyWeight].compactMap { $0 }.joined(separator: " • "),
                trailing: total
            ))
        }

        // Nothing to show and a query failed: the server was unreachable, so
        // don't claim the athlete has no results.
        if rows.isEmpty && (fetchedBests == nil || fetchedResults == nil) {
            return .result(
                dialog: IntentFailure.dialog(),
                view: IntentFailure.view(title: name, systemImage: "trophy.fill")
            )
        }

        let dialog: IntentDialog
        if rows.isEmpty {
            dialog = "I couldn't find results for \(name)."
        } else if let total = positiveKg(best?.best_total) {
            dialog = "\(name)'s best total over \(Self.bestsWindow) is \(total) kilograms."
        } else {
            dialog = "Here are recent results for \(name)."
        }

        return .result(
            dialog: dialog,
            view: SnippetListView(
                title: name,
                subtitle: "Results",
                rows: rows,
                emptyMessage: "No results found",
                systemImage: "trophy.fill"
            )
        )
    }
}

// MARK: - Comp-data intents (App Group payloads)

/// A lift or total in whole kilograms, or nil when missing or not positive:
/// the API sends 0 for "no lift", which is never a real 0 kg best.
private func positiveKg(_ value: Double?) -> Int? {
    guard let value, value > 0 else { return nil }
    return Int(value)
}

/// A weight in kg, or "—" for none. The reference tables answer `0` for "no
/// record set / no standard" (every U15 B standard), so `<= 0` is none too,
/// as in the app's `formatReferenceKg` (src/lib/reference-values.ts).
private func kgString(_ value: Double?) -> String {
    guard let value, value.isFinite, value > 0 else { return "—" }
    if value.rounded() == value {
        return "\(Int(value))kg"
    }
    return "\(value)kg"
}

private func compDataEntities(category: String, rows: [SnippetRow]) -> [CompDataRowEntity] {
    rows.enumerated().map { index, row in
        CompDataRowEntity(
            id: "\(category)-\(index)-\(row.leading)-\(row.title)-\(row.trailing ?? "")",
            category: category,
            leading: row.leading,
            title: row.title,
            subtitle: row.subtitle,
            trailing: row.trailing
        )
    }
}

private func compDataResult(
    payload: SharedDataPayload?,
    fallbackTitle: String,
    systemImage: String
) -> (IntentDialog, SnippetListView, [CompDataRowEntity]) {
    guard let payload else {
        let view = SnippetListView(
            title: fallbackTitle,
            subtitle: nil,
            rows: [],
            emptyMessage: "Open MeetCal and choose filters to see this data.",
            systemImage: systemImage
        )
        return ("Open MeetCal and choose your filters to see \(fallbackTitle).", view, [])
    }

    let rows = payload.rows.map {
        SnippetRow(leading: $0.leading, title: $0.title, subtitle: $0.subtitle, trailing: $0.trailing)
    }
    let dialog: IntentDialog = payload.rows.isEmpty
        ? "\(payload.emptyMessage)"
        : "Here are your \(payload.title)."
    let view = SnippetListView(
        title: payload.title,
        subtitle: payload.subtitle,
        rows: rows,
        emptyMessage: payload.emptyMessage,
        systemImage: systemImage
    )
    return (dialog, view, compDataEntities(category: payload.title, rows: rows))
}

// MARK: - Comp data filter helpers

/// Case-insensitive equality; a `nil`/empty filter matches everything.
private func matchEq(_ value: String?, _ filter: String?) -> Bool {
    guard let filter, !filter.isEmpty else { return true }
    return (value ?? "").caseInsensitiveCompare(filter) == .orderedSame
}

/// Case-insensitive substring match; a `nil`/empty filter matches everything.
private func matchContains(_ value: String?, _ filter: String?) -> Bool {
    guard let filter, !filter.isEmpty else { return true }
    return (value ?? "").range(of: filter, options: .caseInsensitive) != nil
}

/// Weight classes as the tables spell them ("89", "89kg", "+109kg", "109+kg",
/// ">86") and as Siri hears them ("89 kg", "109 plus"), reduced to one key:
/// the number, marked when it is a plus class. "109" and "+109" stay apart.
func weightClassKey(_ value: String) -> String {
    let compact = value.lowercased().filter { !$0.isWhitespace }
    let number = compact.filter { $0.isASCII && ($0.isNumber || $0 == ".") }
    guard !number.isEmpty else { return compact }
    let isPlus = compact.contains("+") || compact.contains(">") || compact.hasSuffix("plus")
    return isPlus ? "+\(number)" : number
}

/// Weight-class match through `weightClassKey`; a `nil`/empty filter matches
/// everything.
private func matchWeightClass(_ value: String?, _ filter: String?) -> Bool {
    guard let filter, !filter.isEmpty else { return true }
    return weightClassKey(value ?? "") == weightClassKey(filter)
}

/// The rows an answer shows. The table's own rows only when the user gave no
/// filters at all (the Nationals / Men / Senior defaults found nothing);
/// filters the user gave that match nothing answer nothing, never another
/// category's rows.
private func rowsToShow<Row>(filtered: [Row], all: [Row], filters: CompDataFilters) -> [Row] {
    filtered.isEmpty && filters.isEmpty ? all : filtered
}

/// "I couldn't find standards for Women U17. Standards exist for Junior,
/// Senior and Youth." The second sentence only when the asked-for age
/// category is not in the table at all (the Siri picker offers categories
/// some tables do not have).
private func missDialog(
    noun: String,
    filterLabels: [String?],
    askedAgeCategory: String?,
    tableAgeCategories: [String?]
) -> IntentDialog {
    let described = filterLabels.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
    var text = described.isEmpty
        ? "I couldn't find \(noun)."
        : "I couldn't find \(noun) for \(described)."
    let available = Array(Set(tableAgeCategories.compactMap { $0 }.filter { !$0.isEmpty })).sorted()
    if let askedAgeCategory,
       !available.isEmpty,
       !available.contains(where: { $0.caseInsensitiveCompare(askedAgeCategory) == .orderedSame }) {
        let list = available.count == 1
            ? available[0]
            : available.dropLast().joined(separator: ", ") + " and " + (available.last ?? "")
        text += " \(noun.prefix(1).uppercased() + noun.dropFirst()) exist for \(list)."
    }
    return "\(text)"
}

/// Builds a " • "-joined subtitle from the non-empty applied filter labels.
private func filterSubtitle(_ parts: [String?]) -> String {
    let joined = parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " • ")
    return joined.isEmpty ? "Latest data" : joined
}

/// Runs a live comp-data lookup, answering the unreachable-server result when
/// it throws.
private func liveOrUnreachable(
    title: String,
    systemImage: String,
    _ load: () async throws -> (IntentDialog, SnippetListView, [CompDataRowEntity])
) async -> (IntentDialog, SnippetListView, [CompDataRowEntity]) {
    do {
        return try await load()
    } catch {
        return (IntentFailure.dialog(), IntentFailure.view(title: title, systemImage: systemImage), [])
    }
}

private func liveQualifyingTotalsResult(filters: CompDataFilters) async throws -> (IntentDialog, SnippetListView, [CompDataRowEntity]) {
    let apiRows = try await MeetCalAPI.shared.qualifyingTotals()
    // With no filters, fall back to the previous Nationals / Men / Senior default.
    let gender = filters.gender ?? (filters.isEmpty ? "Men" : nil)
    let age = filters.ageCategory ?? (filters.isEmpty ? "Senior" : nil)
    let event = filters.event ?? (filters.isEmpty ? "Nationals" : nil)
    let filtered = apiRows.filter {
        matchEq($0.gender, gender)
            && matchEq($0.age_category, age)
            && matchContains($0.event_name, event)
            && matchWeightClass($0.weight_class, filters.weightClass)
    }
    let selected = rowsToShow(filtered: filtered, all: apiRows, filters: filters)
    let rows = selected.prefix(8).map {
        SnippetRow(
            leading: $0.weight_class ?? "",
            title: $0.event_name ?? "Qualifying Total",
            subtitle: [$0.gender, $0.age_category].compactMap { $0 }.joined(separator: " • "),
            trailing: kgString($0.qualifying_total)
        )
    }
    let view = SnippetListView(
        title: "Qualifying Totals",
        subtitle: filtered.isEmpty && filters.isEmpty ? "Latest data" : filterSubtitle([event, gender, age, filters.weightClass]),
        rows: rows,
        emptyMessage: "No qualifying totals found",
        systemImage: "target"
    )
    let dialog: IntentDialog = rows.isEmpty
        ? missDialog(
            noun: "qualifying totals",
            filterLabels: [event, gender, age, filters.weightClass],
            askedAgeCategory: filters.ageCategory,
            tableAgeCategories: apiRows.map(\.age_category)
        )
        : "Here are qualifying totals from MeetCal."
    return (dialog, view, compDataEntities(category: "Qualifying Totals", rows: rows))
}

private func liveStandardsResult(filters: CompDataFilters) async throws -> (IntentDialog, SnippetListView, [CompDataRowEntity]) {
    let apiRows = try await MeetCalAPI.shared.standards()
    let gender = filters.gender ?? (filters.isEmpty ? "Men" : nil)
    let age = filters.ageCategory ?? (filters.isEmpty ? "Senior" : nil)
    let filtered = apiRows.filter {
        matchEq($0.gender, gender)
            && matchEq($0.age_category, age)
            && matchWeightClass($0.weight_class, filters.weightClass)
    }
    let selected = rowsToShow(filtered: filtered, all: apiRows, filters: filters)
    let rows = selected.prefix(8).map {
        SnippetRow(
            leading: $0.weight_class ?? "",
            title: kgString($0.standard_a),
            subtitle: [$0.gender, $0.age_category].compactMap { $0 }.joined(separator: " • "),
            trailing: kgString($0.standard_b)
        )
    }
    let view = SnippetListView(
        title: "A/B Standards",
        subtitle: filtered.isEmpty && filters.isEmpty ? "Latest data" : filterSubtitle([gender, age, filters.weightClass]),
        rows: rows,
        emptyMessage: "No standards found",
        systemImage: "chart.bar"
    )
    let dialog: IntentDialog = rows.isEmpty
        ? missDialog(
            noun: "standards",
            filterLabels: [gender, age, filters.weightClass],
            askedAgeCategory: filters.ageCategory,
            tableAgeCategories: apiRows.map(\.age_category)
        )
        : "Here are A and B standards from MeetCal."
    return (dialog, view, compDataEntities(category: "A/B Standards", rows: rows))
}

private func liveRankingsResult(filters: CompDataFilters) async throws -> (IntentDialog, SnippetListView, [CompDataRowEntity]) {
    let apiRows = try await MeetCalAPI.shared.intlRankings()
    // With no meet filter, default to the first meet in the feed.
    let meet = filters.meet ?? (filters.isEmpty ? apiRows.first?.meet : nil)
    let gender = filters.gender ?? (filters.isEmpty ? "Men" : nil)
    let age = filters.ageCategory ?? (filters.isEmpty ? "Senior" : nil)
    let filtered = apiRows.filter {
        matchContains($0.meet, meet)
            && matchEq($0.gender, gender)
            && matchEq($0.age_category, age)
            && matchWeightClass($0.weight_class, filters.weightClass)
    }
    let unsorted = rowsToShow(filtered: filtered, all: apiRows, filters: filters)
    // Sort by ranking ascending; rows without a ranking go last.
    let selected = unsorted.sorted { ($0.ranking ?? Int.max) < ($1.ranking ?? Int.max) }
    let rows = selected.prefix(8).map {
        SnippetRow(
            leading: $0.ranking.map { "#\($0)" } ?? "",
            title: $0.name ?? "Athlete",
            subtitle: [$0.weight_class, $0.total.map { kgString($0) }].compactMap { $0 }.joined(separator: " • "),
            trailing: $0.percent_a.map { "\($0)%" }
        )
    }
    let view = SnippetListView(
        title: "International Rankings",
        subtitle: filtered.isEmpty && filters.isEmpty ? "Latest data" : filterSubtitle([meet, gender, age, filters.weightClass]),
        rows: rows,
        emptyMessage: "No rankings found",
        systemImage: "globe.americas.fill"
    )
    let dialog: IntentDialog = rows.isEmpty
        ? missDialog(
            noun: "international rankings",
            filterLabels: [meet, gender, age, filters.weightClass],
            askedAgeCategory: filters.ageCategory,
            tableAgeCategories: apiRows.map(\.age_category)
        )
        : "Here are international rankings from MeetCal."
    return (dialog, view, compDataEntities(category: "International Rankings", rows: rows))
}

private func liveRecordsResult(filters: CompDataFilters) async throws -> (IntentDialog, SnippetListView, [CompDataRowEntity]) {
    let apiRows = try await MeetCalAPI.shared.records()
    let recordType = filters.recordType ?? (filters.isEmpty ? "USAW" : nil)
    let gender = filters.gender ?? (filters.isEmpty ? "Men" : nil)
    let age = filters.ageCategory ?? (filters.isEmpty ? "Senior" : nil)
    let filtered = apiRows.filter {
        matchContains($0.record_type, recordType)
            && matchEq($0.gender, gender)
            && matchEq($0.age_category, age)
            && matchWeightClass($0.weight_class, filters.weightClass)
    }
    let selected = rowsToShow(filtered: filtered, all: apiRows, filters: filters)
    let rows = selected.prefix(8).map {
        SnippetRow(
            leading: $0.weight_class ?? "",
            title: "Sn \(kgString($0.snatch_record))",
            subtitle: [$0.record_type, $0.gender, $0.age_category].compactMap { $0 }.joined(separator: " • "),
            trailing: "Total \(kgString($0.total_record))"
        )
    }
    let view = SnippetListView(
        title: "Records",
        subtitle: filtered.isEmpty && filters.isEmpty ? "Latest data" : filterSubtitle([recordType, gender, age, filters.weightClass]),
        rows: rows,
        emptyMessage: "No records found",
        systemImage: "medal.fill"
    )
    let dialog: IntentDialog = rows.isEmpty
        ? missDialog(
            noun: "records",
            filterLabels: [recordType, gender, age, filters.weightClass],
            askedAgeCategory: filters.ageCategory,
            tableAgeCategories: apiRows.map(\.age_category)
        )
        : "Here are records from MeetCal."
    return (dialog, view, compDataEntities(category: "Records", rows: rows))
}

struct GetQualifyingTotalsIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Qualifying Totals"
    static var description = IntentDescription("Show qualifying totals, optionally filtered by gender, age category, weight class, or event.")

    @Parameter(title: "Gender")
    var gender: IntentGender?

    @Parameter(title: "Age Category")
    var ageCategory: IntentAgeCategory?

    @Parameter(title: "Weight Class")
    var weightClass: String?

    @Parameter(title: "Event")
    var event: String?

    func perform() async throws -> some IntentResult & ReturnsValue<[CompDataRowEntity]> & ProvidesDialog & ShowsSnippetView {
        guard PremiumGate.isUnlocked else {
            let (dialog, view) = PremiumGate.lockedAnswer(.qualifyingTotals)
            return .result(value: [CompDataRowEntity](), dialog: dialog, view: view)
        }
        let filters = CompDataFilters(
            gender: gender?.apiValue,
            ageCategory: ageCategory?.apiValue,
            weightClass: CompDataFilters.clean(weightClass),
            event: CompDataFilters.clean(event)
        )
        // No filters given: prefer the app's last-used selection, then live default.
        if filters.isEmpty {
            var (dialog, view, rows) = compDataResult(
                payload: SharedStore.qualifyingTotalsPayload(),
                fallbackTitle: "Qualifying Totals",
                systemImage: "target"
            )
            if rows.isEmpty {
                (dialog, view, rows) = await liveOrUnreachable(title: "Qualifying Totals", systemImage: "target") {
                    try await liveQualifyingTotalsResult(filters: filters)
                }
            }
            return .result(value: rows, dialog: dialog, view: view)
        }
        let (dialog, view, rows) = await liveOrUnreachable(title: "Qualifying Totals", systemImage: "target") {
            try await liveQualifyingTotalsResult(filters: filters)
        }
        return .result(value: rows, dialog: dialog, view: view)
    }
}

struct GetStandardsIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Standards"
    static var description = IntentDescription("Show A/B standards, optionally filtered by gender, age category, or weight class.")

    @Parameter(title: "Gender")
    var gender: IntentGender?

    @Parameter(title: "Age Category")
    var ageCategory: IntentAgeCategory?

    @Parameter(title: "Weight Class")
    var weightClass: String?

    func perform() async throws -> some IntentResult & ReturnsValue<[CompDataRowEntity]> & ProvidesDialog & ShowsSnippetView {
        guard PremiumGate.isUnlocked else {
            let (dialog, view) = PremiumGate.lockedAnswer(.standards)
            return .result(value: [CompDataRowEntity](), dialog: dialog, view: view)
        }
        let filters = CompDataFilters(
            gender: gender?.apiValue,
            ageCategory: ageCategory?.apiValue,
            weightClass: CompDataFilters.clean(weightClass)
        )
        if filters.isEmpty {
            var (dialog, view, rows) = compDataResult(
                payload: SharedStore.standardsPayload(),
                fallbackTitle: "A/B Standards",
                systemImage: "chart.bar"
            )
            if rows.isEmpty {
                (dialog, view, rows) = await liveOrUnreachable(title: "A/B Standards", systemImage: "chart.bar") {
                    try await liveStandardsResult(filters: filters)
                }
            }
            return .result(value: rows, dialog: dialog, view: view)
        }
        let (dialog, view, rows) = await liveOrUnreachable(title: "A/B Standards", systemImage: "chart.bar") {
            try await liveStandardsResult(filters: filters)
        }
        return .result(value: rows, dialog: dialog, view: view)
    }
}

struct GetRankingsIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Rankings"
    static var description = IntentDescription("Show international rankings, optionally filtered by meet, gender, age category, or weight class.")

    @Parameter(title: "Meet")
    var meet: String?

    @Parameter(title: "Gender")
    var gender: IntentGender?

    @Parameter(title: "Age Category")
    var ageCategory: IntentAgeCategory?

    @Parameter(title: "Weight Class")
    var weightClass: String?

    func perform() async throws -> some IntentResult & ReturnsValue<[CompDataRowEntity]> & ProvidesDialog & ShowsSnippetView {
        guard PremiumGate.isUnlocked else {
            let (dialog, view) = PremiumGate.lockedAnswer(.rankings)
            return .result(value: [CompDataRowEntity](), dialog: dialog, view: view)
        }
        let filters = CompDataFilters(
            gender: gender?.apiValue,
            ageCategory: ageCategory?.apiValue,
            weightClass: CompDataFilters.clean(weightClass),
            meet: CompDataFilters.clean(meet)
        )
        if filters.isEmpty {
            var (dialog, view, rows) = compDataResult(
                payload: SharedStore.intlRankingsPayload(),
                fallbackTitle: "International Rankings",
                systemImage: "globe.americas.fill"
            )
            if rows.isEmpty {
                (dialog, view, rows) = await liveOrUnreachable(title: "International Rankings", systemImage: "globe.americas.fill") {
                    try await liveRankingsResult(filters: filters)
                }
            }
            return .result(value: rows, dialog: dialog, view: view)
        }
        let (dialog, view, rows) = await liveOrUnreachable(title: "International Rankings", systemImage: "globe.americas.fill") {
            try await liveRankingsResult(filters: filters)
        }
        return .result(value: rows, dialog: dialog, view: view)
    }
}

struct GetRecordsIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Records"
    static var description = IntentDescription("Show competition records, optionally filtered by record type, gender, age category, or weight class.")

    @Parameter(title: "Record Type")
    var recordType: String?

    @Parameter(title: "Gender")
    var gender: IntentGender?

    @Parameter(title: "Age Category")
    var ageCategory: IntentAgeCategory?

    @Parameter(title: "Weight Class")
    var weightClass: String?

    func perform() async throws -> some IntentResult & ReturnsValue<[CompDataRowEntity]> & ProvidesDialog & ShowsSnippetView {
        guard PremiumGate.isUnlocked else {
            let (dialog, view) = PremiumGate.lockedAnswer(.records)
            return .result(value: [CompDataRowEntity](), dialog: dialog, view: view)
        }
        let filters = CompDataFilters(
            gender: gender?.apiValue,
            ageCategory: ageCategory?.apiValue,
            weightClass: CompDataFilters.clean(weightClass),
            recordType: CompDataFilters.clean(recordType)
        )
        let (dialog, view, rows) = await liveOrUnreachable(title: "Records", systemImage: "medal.fill") {
            try await liveRecordsResult(filters: filters)
        }
        return .result(value: rows, dialog: dialog, view: view)
    }
}

// MARK: - OpenSessionDetailsIntent

struct OpenSessionDetailsIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Session Details"
    static var description = IntentDescription("Open a saved session's details in MeetCal.")
    static var openAppWhenRun = true

    @Parameter(title: "Session")
    var session: SavedSessionEntity

    func perform() async throws -> some IntentResult & OpensIntent {
        let url = session.deepLinkURL ?? MeetCalDeepLinks.saved
        return .result(opensIntent: OpenURLIntent(url))
    }
}

// MARK: - OpenSavedSessionsIntent

struct OpenSavedSessionsIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Saved Sessions"
    static var description = IntentDescription("Open saved sessions in MeetCal.")
    static var openAppWhenRun = true

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(MeetCalDeepLinks.saved))
    }
}

// MARK: - OpenCompDataIntent

struct OpenCompDataIntent: AppIntent {
    static var title: LocalizedStringResource = "Open Competition Data"
    static var description = IntentDescription("Open a competition data screen in MeetCal.")
    static var openAppWhenRun = true

    @Parameter(title: "Data")
    var destination: CompDataDestination

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(destination.url))
    }
}
