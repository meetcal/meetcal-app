//
//  Queries.swift
//  MeetCal App Intents
//
//  Entity queries. Saved sessions come from the App Group mirror (offline,
//  personal). Meets / athletes / sessions are server-backed via MeetCalAPI —
//  Apple's recommended pattern for large / changing datasets.
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
        let meets = (try? await MeetCalAPI.shared.meets()) ?? []
        let wanted = Set(identifiers)
        return meets
            .map { MeetEntity(api: $0) }
            .filter { wanted.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [MeetEntity] {
        let meets = (try? await MeetCalAPI.shared.meets()) ?? []
        let needle = string.lowercased()
        return meets
            .map { MeetEntity(api: $0) }
            .filter { needle.isEmpty || $0.name.lowercased().contains(needle) || $0.location.lowercased().contains(needle) }
    }

    func suggestedEntities() async throws -> [MeetEntity] {
        let meets = (try? await MeetCalAPI.shared.meets()) ?? []
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
        let athletes = (try? await MeetCalAPI.shared.athletes(meet: meet)) ?? []
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
            let athletes = (try? await MeetCalAPI.shared.athletes(meet: meet)) ?? []
            let matches = athletes
                .map { AthleteEntity(api: $0) }
                .filter { $0.name.lowercased().contains(needle) }
            if !matches.isEmpty { return matches }
        }

        // Fall back to the global search endpoint.
        let response = try? await MeetCalAPI.shared.search(string)
        let names =
            [response?.matched_name].compactMap { $0 }
            + (response?.suggestions ?? [])
            + (response?.results?.compactMap { $0.name } ?? [])
        var seen = Set<String>()
        return names.compactMap { name -> AthleteEntity? in
            guard seen.insert(name.lowercased()).inserted else { return nil }
            return AthleteEntity(id: name, name: name, club: nil, weightClass: nil, sessionNumber: nil, platform: nil)
        }
    }

    func suggestedEntities() async throws -> [AthleteEntity] {
        let meet = SharedStore.selectedMeet
        guard !meet.isEmpty else { return [] }
        let athletes = (try? await MeetCalAPI.shared.athletes(meet: meet)) ?? []
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

    static func sessions(forMeet meet: String) async -> [SessionEntity] {
        let rows = (try? await MeetCalAPI.shared.schedule(meet: meet)) ?? []
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
                grouped[key] = SessionEntity(
                    id: key,
                    meet: meet,
                    sessionNumber: row.session_id,
                    platform: row.platform,
                    weightClass: row.weight_class,
                    startTime: row.start_time,
                    weighInTime: row.weigh_in_time,
                    date: row.date
                )
            }
        }
        return grouped.values.sorted {
            $0.sessionNumber == $1.sessionNumber
                ? $0.platform < $1.platform
                : $0.sessionNumber < $1.sessionNumber
        }
    }

    func entities(for identifiers: [SessionEntity.ID]) async throws -> [SessionEntity] {
        let meet = SharedStore.selectedMeet
        guard !meet.isEmpty else { return [] }
        let all = await Self.sessions(forMeet: meet)
        let wanted = Set(identifiers)
        return all.filter { wanted.contains($0.id) }
    }

    func entities(matching string: String) async throws -> [SessionEntity] {
        let meet = SharedStore.selectedMeet
        guard !meet.isEmpty else { return [] }
        let all = await Self.sessions(forMeet: meet)
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
        return await Self.sessions(forMeet: meet)
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
