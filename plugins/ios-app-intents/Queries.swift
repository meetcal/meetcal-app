//
//  Queries.swift
//  MeetCal App Intents
//
//  Entity queries. Saved sessions come from the App Group mirror (offline,
//  personal). Meets / athletes / sessions are server-backed via MeetCalAPI —
//  Apple's recommended pattern for large / changing datasets. Server-backed
//  queries throw on a network or server failure instead of answering `[]`,
//  so Siri never reports an outage as "nothing found".
//

import Foundation
import AppIntents

// MARK: - SavedSessionQuery (local, enumerable)

struct SavedSessionQuery: EnumerableEntityQuery {
    func allEntities() async throws -> [SavedSessionEntity] {
        let selectedMeet = SharedStore.selectedMeet
        return SharedStore.savedSessions().map {
            SavedSessionEntity(shared: $0, fallbackMeet: selectedMeet)
        }
    }

    func entities(for identifiers: [SavedSessionEntity.ID]) async throws -> [SavedSessionEntity] {
        let all = try await allEntities()
        let wanted = Set(identifiers)
        return all.filter { wanted.contains($0.id) }
    }

    func suggestedEntities() async throws -> [SavedSessionEntity] {
        try await allEntities()
    }
}

// MARK: - MeetQuery (server-backed string query)

struct MeetQuery: EntityStringQuery {
    func entities(for identifiers: [MeetEntity.ID]) async throws -> [MeetEntity] {
        let meets = try await MeetCalAPI.shared.meets()
        let wanted = Set(identifiers)
        return meets
            .map { MeetEntity(api: $0) }
            .filter { wanted.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [MeetEntity] {
        let meets = try await MeetCalAPI.shared.meets()
        let needle = string.lowercased()
        return meets
            .map { MeetEntity(api: $0) }
            .filter { needle.isEmpty || $0.name.lowercased().contains(needle) || $0.location.lowercased().contains(needle) }
    }

    func suggestedEntities() async throws -> [MeetEntity] {
        let meets = try await MeetCalAPI.shared.meets()
        return meets.prefix(10).map { MeetEntity(api: $0) }
    }
}

// MARK: - AthleteQuery (server-backed string query)

struct AthleteQuery: EntityStringQuery {
    func entities(for identifiers: [AthleteEntity.ID]) async throws -> [AthleteEntity] {
        // Athlete identifiers are member ids / names; resolve against the
        // selected meet's roster where possible.
        let meet = SharedStore.selectedMeet
        guard !meet.isEmpty else { return [] }
        let athletes = try await MeetCalAPI.shared.athletes(meet: meet)
        let wanted = Set(identifiers)
        return athletes
            .map { AthleteEntity(api: $0) }
            .filter { wanted.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [AthleteEntity] {
        let needle = string.lowercased()
        let meet = SharedStore.selectedMeet

        // Prefer the selected meet's roster (has session/platform info).
        if !meet.isEmpty {
            let athletes = try await MeetCalAPI.shared.athletes(meet: meet)
            let matches = athletes
                .map { AthleteEntity(api: $0) }
                .filter { $0.name.lowercased().contains(needle) }
            // Dedupe by name, preferring the entry that carries session/platform info.
            var best: [String: AthleteEntity] = [:]
            var order: [String] = []
            for match in matches {
                let key = match.name.lowercased()
                if let existing = best[key] {
                    if existing.sessionNumber == nil, match.sessionNumber != nil {
                        best[key] = match
                    }
                } else {
                    best[key] = match
                    order.append(key)
                }
            }
            let deduped = order.compactMap { best[$0] }
            if !deduped.isEmpty { return deduped }
        }

        // Fall back to the global search endpoint, which rejects an empty
        // query: nothing to search for is "no matches", not a failure.
        guard !string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        let response = try await MeetCalAPI.shared.search(string)
        let names =
            [response.matched_name].compactMap { $0 }
            + (response.suggestions ?? [])
            + (response.results?.compactMap { $0.name } ?? [])
        var seen = Set<String>()
        return names.compactMap { name -> AthleteEntity? in
            guard seen.insert(name.lowercased()).inserted else { return nil }
            return AthleteEntity(id: name, name: name, club: nil, weightClass: nil, sessionNumber: nil, platform: nil)
        }
    }

    func suggestedEntities() async throws -> [AthleteEntity] {
        let meet = SharedStore.selectedMeet
        guard !meet.isEmpty else { return [] }
        let athletes = try await MeetCalAPI.shared.athletes(meet: meet)
        return athletes.prefix(10).map { AthleteEntity(api: $0) }
    }
}

// MARK: - SessionQuery (server-backed string query)

struct SessionQuery: EntityStringQuery {
    /// Session ids encode `meet||sessionNumber||platform` so they can be
    /// rebuilt from the schedule without extra state.
    static func makeID(meet: String, sessionNumber: Int, platform: String) -> String {
        "\(meet)||\(sessionNumber)||\(platform)"
    }

    /// The meet a session id was built for, or nil for an id not built by
    /// `makeID`. Read from the right, so a meet name containing `||` survives.
    static func meet(fromID id: String) -> String? {
        let parts = id.components(separatedBy: "||")
        guard parts.count >= 3, Int(parts[parts.count - 2]) != nil else { return nil }
        let meet = parts.dropLast(2).joined(separator: "||")
        return meet.isEmpty ? nil : meet
    }

    /// Resolves ids against the schedule of the meet each id names, not the
    /// meet selected in the app now: an id from another meet (a schedule
    /// asked for by name, a Spotlight item indexed before the user switched
    /// meets) still resolves. One schedule request per distinct meet, one at
    /// a time; the meets are never more than the ids the system passed, so
    /// every valid id resolves rather than a capped few.
    static func sessions(withIDs identifiers: [String]) async throws -> [SessionEntity] {
        var meets: [String] = []
        for id in identifiers {
            if let meet = meet(fromID: id), !meets.contains(meet) { meets.append(meet) }
        }
        let wanted = Set(identifiers)
        var found: [SessionEntity] = []
        var firstError: Error?
        for meet in meets {
            // One meet's failed request doesn't lose the others' sessions.
            do {
                found += try await sessions(forMeet: meet).filter { wanted.contains($0.id) }
            } catch {
                firstError = firstError ?? error
            }
        }
        // Nothing resolved and a request failed: report it rather than "no such sessions".
        if found.isEmpty, let firstError { throw firstError }
        return found
    }

    static func sessions(forMeet meet: String) async throws -> [SessionEntity] {
        let rows = try await MeetCalAPI.shared.schedule(meet: meet)
        // Group by (session_id, platform); join weight classes.
        var grouped: [String: SessionEntity] = [:]
        for row in rows {
            let key = makeID(meet: meet, sessionNumber: row.session_id, platform: row.platform)
            if var existing = grouped[key] {
                if let wc = existing.weightClass, !wc.contains(row.weight_class) {
                    existing.weightClass = wc + ", " + row.weight_class
                    grouped[key] = existing
                }
            } else {
                // Times as the app shows them ("2:00 PM"), not as stored.
                grouped[key] = SessionEntity(
                    id: key,
                    meet: meet,
                    sessionNumber: row.session_id,
                    platform: row.platform,
                    weightClass: row.weight_class,
                    startTime: APITimeFormat.display(row.start_time),
                    weighInTime: row.weigh_in_time.map(APITimeFormat.display),
                    date: row.date
                )
            }
        }
        // Day, then session number, then platform, as the API orders them:
        // a multi-day meet's session 1 on day two comes after day one.
        return grouped.values.sorted { lhs, rhs in
            let lhsDate = lhs.date ?? ""
            let rhsDate = rhs.date ?? ""
            if lhsDate != rhsDate { return lhsDate < rhsDate }
            if lhs.sessionNumber != rhs.sessionNumber { return lhs.sessionNumber < rhs.sessionNumber }
            return lhs.platform < rhs.platform
        }
    }

    func entities(for identifiers: [SessionEntity.ID]) async throws -> [SessionEntity] {
        try await Self.sessions(withIDs: identifiers)
    }

    func entities(matching string: String) async throws -> [SessionEntity] {
        let meet = SharedStore.selectedMeet
        guard !meet.isEmpty else { return [] }
        let all = try await Self.sessions(forMeet: meet)
        let needle = string.lowercased()
        return all.filter {
            needle.isEmpty
                || "\($0.sessionNumber)".contains(needle)
                || $0.platform.lowercased().contains(needle)
                || ($0.weightClass?.lowercased().contains(needle) ?? false)
        }
    }

    func suggestedEntities() async throws -> [SessionEntity] {
        let meet = SharedStore.selectedMeet
        guard !meet.isEmpty else { return [] }
        return try await Self.sessions(forMeet: meet)
    }
}

// MARK: - CompDataRowQuery

struct CompDataRowQuery: EnumerableEntityQuery {
    func allEntities() async throws -> [CompDataRowEntity] {
        []
    }

    func entities(for identifiers: [CompDataRowEntity.ID]) async throws -> [CompDataRowEntity] {
        []
    }

    func suggestedEntities() async throws -> [CompDataRowEntity] {
        []
    }
}
