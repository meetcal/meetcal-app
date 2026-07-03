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

// MARK: - FindMeetsIntent

struct FindMeetsIntent: AppIntent {
    static var title: LocalizedStringResource = "Find Meets"
    static var description = IntentDescription("Find upcoming weightlifting meets, optionally filtered by a search term.")

    @Parameter(title: "Search", requestValueDialog: "Which meets are you looking for?")
    var searchTerm: String?

    func perform() async throws -> some IntentResult & ReturnsValue<[MeetEntity]> & ProvidesDialog & ShowsSnippetView {
        let apiMeets = (try? await MeetCalAPI.shared.meets()) ?? []
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
        let matches = (try? await AthleteEntity.defaultQuery.entities(matching: name)) ?? []
        let limited = Array(matches.prefix(8))

        let rows = limited.map { athlete -> SnippetRow in
            var subtitleParts: [String] = []
            if let wc = athlete.weightClass, !wc.isEmpty { subtitleParts.append(wc) }
            if let club = athlete.club, !club.isEmpty { subtitleParts.append(club) }
            var trailing: String?
            if let session = athlete.sessionNumber, let platform = athlete.platform {
                trailing = "S\(session) • \(platform)"
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

        let sessions = await SessionQuery.sessions(forMeet: meetName)
        let limited = Array(sessions.prefix(12))
        let rows = limited.map { session -> SnippetRow in
            var subtitleParts: [String] = []
            if let wc = session.weightClass, !wc.isEmpty { subtitleParts.append(wc) }
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

        let dialog: IntentDialog = saved.isEmpty
            ? "You don't have any saved sessions yet."
            : "You have \(saved.count) saved sessions."

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

    func perform() async throws -> some IntentResult & ProvidesDialog & ShowsSnippetView {
        async let bestsTask = MeetCalAPI.shared.bests(names: [name])
        async let resultsTask = MeetCalAPI.shared.resultsByNames([name])
        let bests = (try? await bestsTask) ?? [:]
        let results = (try? await resultsTask) ?? []

        var rows: [SnippetRow] = []

        if let best = bests[name] ?? bests.values.first {
            let snatch = best.best_snatch.map { Int($0) }
            let cj = best.best_cj.map { Int($0) }
            let total = best.best_total.map { Int($0) }
            rows.append(SnippetRow(
                leading: "",
                title: "Season Bests",
                subtitle: "Sn \(snatch.map(String.init) ?? "—") • CJ \(cj.map(String.init) ?? "—")",
                trailing: total.map { "\($0) kg" } ?? "—"
            ))
        }

        for result in results.prefix(5) {
            let total = result.total.map { "\($0) kg" } ?? "—"
            rows.append(SnippetRow(
                leading: "",
                title: result.meet ?? "Meet",
                subtitle: [result.date.map { APIDateFormat.pretty($0) }, result.body_weight.map { "\($0) kg BW" }].compactMap { $0 }.joined(separator: " • "),
                trailing: total
            ))
        }

        let dialog: IntentDialog
        if rows.isEmpty {
            dialog = "I couldn't find results for \(name)."
        } else if let best = bests[name] ?? bests.values.first, let total = best.best_total {
            dialog = "\(name)'s best total this season is \(Int(total)) kilograms."
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

private func kgString(_ value: Double?) -> String {
    guard let value else { return "—" }
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

private func liveQualifyingTotalsResult() async -> (IntentDialog, SnippetListView, [CompDataRowEntity]) {
    let apiRows = (try? await MeetCalAPI.shared.qualifyingTotals()) ?? []
    let preferred = apiRows.filter {
        ($0.event_name ?? "") == "Nationals"
            && ($0.gender ?? "") == "Men"
            && ($0.age_category ?? "") == "Senior"
    }
    let selected = preferred.isEmpty ? apiRows : preferred
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
        subtitle: preferred.isEmpty ? "Latest data" : "Nationals • Men • Senior",
        rows: rows,
        emptyMessage: "No qualifying totals found",
        systemImage: "target"
    )
    let dialog: IntentDialog = rows.isEmpty
        ? "I couldn't find qualifying totals."
        : "Here are qualifying totals from MeetCal."
    return (dialog, view, compDataEntities(category: "Qualifying Totals", rows: rows))
}

private func liveStandardsResult() async -> (IntentDialog, SnippetListView, [CompDataRowEntity]) {
    let apiRows = (try? await MeetCalAPI.shared.standards()) ?? []
    let preferred = apiRows.filter {
        ($0.gender ?? "") == "Men"
            && ($0.age_category ?? "") == "Senior"
    }
    let selected = preferred.isEmpty ? apiRows : preferred
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
        subtitle: preferred.isEmpty ? "Latest data" : "Men • Senior",
        rows: rows,
        emptyMessage: "No standards found",
        systemImage: "chart.bar"
    )
    let dialog: IntentDialog = rows.isEmpty
        ? "I couldn't find standards."
        : "Here are A and B standards from MeetCal."
    return (dialog, view, compDataEntities(category: "A/B Standards", rows: rows))
}

private func liveRankingsResult() async -> (IntentDialog, SnippetListView, [CompDataRowEntity]) {
    let apiRows = (try? await MeetCalAPI.shared.intlRankings()) ?? []
    let defaultMeet = apiRows.first?.meet
    let preferred = apiRows.filter {
        (defaultMeet == nil || $0.meet == defaultMeet)
            && ($0.gender ?? "") == "Men"
            && ($0.age_category ?? "") == "Senior"
    }
    let selected = preferred.isEmpty ? apiRows : preferred
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
        subtitle: [defaultMeet, "Men", "Senior"].compactMap { $0 }.joined(separator: " • "),
        rows: rows,
        emptyMessage: "No rankings found",
        systemImage: "globe.americas.fill"
    )
    let dialog: IntentDialog = rows.isEmpty
        ? "I couldn't find international rankings."
        : "Here are international rankings from MeetCal."
    return (dialog, view, compDataEntities(category: "International Rankings", rows: rows))
}

private func liveRecordsResult() async -> (IntentDialog, SnippetListView, [CompDataRowEntity]) {
    let apiRows = (try? await MeetCalAPI.shared.records()) ?? []
    let preferred = apiRows.filter {
        ($0.record_type ?? "") == "USAW"
            && ($0.gender ?? "") == "Men"
            && ($0.age_category ?? "") == "Senior"
    }
    let selected = preferred.isEmpty ? apiRows : preferred
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
        subtitle: preferred.isEmpty ? "Latest data" : "USAW • Men • Senior",
        rows: rows,
        emptyMessage: "No records found",
        systemImage: "medal.fill"
    )
    let dialog: IntentDialog = rows.isEmpty
        ? "I couldn't find records."
        : "Here are records from MeetCal."
    return (dialog, view, compDataEntities(category: "Records", rows: rows))
}

struct GetQualifyingTotalsIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Qualifying Totals"
    static var description = IntentDescription("Show qualifying totals for your selected filters.")

    func perform() async throws -> some IntentResult & ReturnsValue<[CompDataRowEntity]> & ProvidesDialog & ShowsSnippetView {
        var (dialog, view, rows) = compDataResult(
            payload: SharedStore.qualifyingTotalsPayload(),
            fallbackTitle: "Qualifying Totals",
            systemImage: "target"
        )
        if rows.isEmpty {
            (dialog, view, rows) = await liveQualifyingTotalsResult()
        }
        return .result(value: rows, dialog: dialog, view: view)
    }
}

struct GetStandardsIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Standards"
    static var description = IntentDescription("Show A/B standards for your selected filters.")

    func perform() async throws -> some IntentResult & ReturnsValue<[CompDataRowEntity]> & ProvidesDialog & ShowsSnippetView {
        var (dialog, view, rows) = compDataResult(
            payload: SharedStore.standardsPayload(),
            fallbackTitle: "A/B Standards",
            systemImage: "chart.bar"
        )
        if rows.isEmpty {
            (dialog, view, rows) = await liveStandardsResult()
        }
        return .result(value: rows, dialog: dialog, view: view)
    }
}

struct GetRankingsIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Rankings"
    static var description = IntentDescription("Show international rankings for your selected filters.")

    func perform() async throws -> some IntentResult & ReturnsValue<[CompDataRowEntity]> & ProvidesDialog & ShowsSnippetView {
        var (dialog, view, rows) = compDataResult(
            payload: SharedStore.intlRankingsPayload(),
            fallbackTitle: "International Rankings",
            systemImage: "globe.americas.fill"
        )
        if rows.isEmpty {
            (dialog, view, rows) = await liveRankingsResult()
        }
        return .result(value: rows, dialog: dialog, view: view)
    }
}

struct GetRecordsIntent: AppIntent {
    static var title: LocalizedStringResource = "Get Records"
    static var description = IntentDescription("Show competition records from MeetCal.")

    func perform() async throws -> some IntentResult & ReturnsValue<[CompDataRowEntity]> & ProvidesDialog & ShowsSnippetView {
        let (dialog, view, rows) = await liveRecordsResult()
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
