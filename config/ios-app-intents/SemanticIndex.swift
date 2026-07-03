//
//  SemanticIndex.swift
//  MeetCal App Intents
//
//  Donates entities to the Spotlight index so Siri AI (iOS 27) can answer from
//  them. `IndexedEntity` + `CSSearchableIndex.indexAppEntities` exist since
//  iOS 18; richer Spotlight key mapping with `@Property(indexingKey:)` is
//  available starting in iOS 18.4, so semantic wrapper entities are gated there
//  while the app keeps its iOS 18.0 deployment target.
//

import Foundation
import AppIntents

#if canImport(CoreSpotlight)
import CoreSpotlight
import UniformTypeIdentifiers

// MARK: - IndexedEntity conformances (iOS 18+)

extension SavedSessionEntity: IndexedEntity {
    var attributeSet: CSSearchableItemAttributeSet {
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.text)
        attributes.title = "Session \(sessionNumber) — \(meet)"
        var descriptionParts: [String] = [platform]
        if !weightClass.isEmpty { descriptionParts.append(weightClass) }
        if !startTime.isEmpty { descriptionParts.append(startTime) }
        attributes.contentDescription = descriptionParts.joined(separator: " • ")
        attributes.keywords = ["session", "saved", meet, platform, weightClass].filter { !$0.isEmpty }
        return attributes
    }
}

extension MeetEntity: IndexedEntity {
    var attributeSet: CSSearchableItemAttributeSet {
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.text)
        attributes.title = name
        attributes.contentDescription = [dates, location].filter { !$0.isEmpty }.joined(separator: " • ")
        attributes.keywords = ["meet", "competition", name, location].filter { !$0.isEmpty }
        return attributes
    }
}

extension SessionEntity: IndexedEntity {
    var attributeSet: CSSearchableItemAttributeSet {
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.text)
        attributes.title = "Session \(sessionNumber) — \(meet)"
        var descriptionParts: [String] = [platform]
        if let weightClass, !weightClass.isEmpty { descriptionParts.append(weightClass) }
        if let startTime, !startTime.isEmpty { descriptionParts.append(startTime) }
        attributes.contentDescription = descriptionParts.joined(separator: " • ")
        attributes.keywords = ["session", meet, platform, weightClass ?? ""].filter { !$0.isEmpty }
        return attributes
    }
}

// MARK: - Semantic IndexedEntity wrappers (iOS 18.4+)

@available(iOS 18.4, *)
struct SemanticSavedSessionEntity: IndexedEntity, Identifiable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Saved Session")
    static var defaultQuery = SemanticSavedSessionQuery()

    var id: String

    @Property(indexingKey: \.title)
    var title: String

    @Property(indexingKey: \.contentDescription)
    var detail: String?

    var keywords: [String]

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: detail.map { "\($0)" })
    }

    var attributeSet: CSSearchableItemAttributeSet {
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.text)
        attributes.title = title
        attributes.contentDescription = detail
        attributes.keywords = keywords
        return attributes
    }

    init(_ session: SavedSessionEntity) {
        let title = "Session \(session.sessionNumber) — \(session.meet)"
        let detail = [session.platform, session.weightClass, session.startTime]
            .filter { !$0.isEmpty }
            .joined(separator: " • ")
        let keywords = ["session", "saved", session.meet, session.platform, session.weightClass]
            .filter { !$0.isEmpty }

        self.id = session.id
        self._title = EntityProperty<String>(indexingKey: \.title)
        self._detail = EntityProperty<String?>(indexingKey: \.contentDescription)
        self.keywords = keywords
        self.title = title
        self.detail = detail
    }
}

@available(iOS 18.4, *)
struct SemanticSavedSessionQuery: EntityQuery {
    func entities(for identifiers: [SemanticSavedSessionEntity.ID]) async throws -> [SemanticSavedSessionEntity] {
        let wanted = Set(identifiers)
        let selectedMeet = SharedStore.selectedMeet
        return SharedStore.savedSessions()
            .map { SavedSessionEntity(shared: $0, fallbackMeet: selectedMeet) }
            .filter { wanted.contains($0.id) }
            .map(SemanticSavedSessionEntity.init)
    }
}

@available(iOS 18.4, *)
struct SemanticMeetEntity: IndexedEntity, Identifiable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Meet")
    static var defaultQuery = SemanticMeetQuery()

    var id: String

    @Property(indexingKey: \.title)
    var title: String

    @Property(indexingKey: \.contentDescription)
    var detail: String?

    var keywords: [String]

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: detail.map { "\($0)" })
    }

    var attributeSet: CSSearchableItemAttributeSet {
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.text)
        attributes.title = title
        attributes.contentDescription = detail
        attributes.keywords = keywords
        return attributes
    }

    init(_ meet: MeetEntity) {
        let detail = [meet.dates, meet.location].filter { !$0.isEmpty }.joined(separator: " • ")

        self.id = meet.id
        self._title = EntityProperty<String>(indexingKey: \.title)
        self._detail = EntityProperty<String?>(indexingKey: \.contentDescription)
        self.keywords = ["meet", "competition", meet.name, meet.location].filter { !$0.isEmpty }
        self.title = meet.name
        self.detail = detail
    }
}

@available(iOS 18.4, *)
struct SemanticMeetQuery: EntityQuery {
    func entities(for identifiers: [SemanticMeetEntity.ID]) async throws -> [SemanticMeetEntity] {
        let wanted = Set(identifiers)
        let meets = (try? await MeetCalAPI.shared.meets()) ?? []
        return meets
            .map { MeetEntity(api: $0) }
            .filter { wanted.contains($0.id) }
            .map(SemanticMeetEntity.init)
    }
}

@available(iOS 18.4, *)
struct SemanticSessionEntity: IndexedEntity, Identifiable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Session")
    static var defaultQuery = SemanticSessionQuery()

    var id: String

    @Property(indexingKey: \.title)
    var title: String

    @Property(indexingKey: \.contentDescription)
    var detail: String?

    var keywords: [String]

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: detail.map { "\($0)" })
    }

    var attributeSet: CSSearchableItemAttributeSet {
        let attributes = CSSearchableItemAttributeSet(contentType: UTType.text)
        attributes.title = title
        attributes.contentDescription = detail
        attributes.keywords = keywords
        return attributes
    }

    init(_ session: SessionEntity) {
        let title = "Session \(session.sessionNumber) — \(session.meet)"
        let detail = [
            session.platform,
            session.weightClass,
            session.startTime,
        ].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " • ")
        let keywords = ["session", session.meet, session.platform, session.weightClass ?? ""]
            .filter { !$0.isEmpty }

        self.id = session.id
        self._title = EntityProperty<String>(indexingKey: \.title)
        self._detail = EntityProperty<String?>(indexingKey: \.contentDescription)
        self.keywords = keywords
        self.title = title
        self.detail = detail
    }
}

@available(iOS 18.4, *)
struct SemanticSessionQuery: EntityQuery {
    func entities(for identifiers: [SemanticSessionEntity.ID]) async throws -> [SemanticSessionEntity] {
        let selectedMeet = SharedStore.selectedMeet
        guard !selectedMeet.isEmpty else { return [] }

        let wanted = Set(identifiers)
        return await SessionQuery.sessions(forMeet: selectedMeet)
            .filter { wanted.contains($0.id) }
            .map(SemanticSessionEntity.init)
    }
}

// MARK: - Donation

enum SemanticIndexDonator {
    /// Reads the App Group mirror + upcoming meets and (re)donates them to the
    /// Spotlight index, removing stale entries first. Safe no-op on failure.
    static func donateAll() async {
        guard CSSearchableIndex.isIndexingAvailable() else { return }
        let index = CSSearchableIndex.default()

        // Remove previously donated entities so unsaved sessions / past meets
        // don't linger in the index. The app registers no other CoreSpotlight
        // items, so clearing the default index is safe and avoids depending on
        // the newer per-type delete APIs.
        try? await index.deleteAllSearchableItems()

        // Saved sessions (personal, offline).
        let selectedMeet = SharedStore.selectedMeet
        let savedSessions = SharedStore.savedSessions().map {
            SavedSessionEntity(shared: $0, fallbackMeet: selectedMeet)
        }
        if !savedSessions.isEmpty {
            if #available(iOS 18.4, *) {
                try? await index.indexAppEntities(savedSessions.map(SemanticSavedSessionEntity.init))
            } else {
                try? await index.indexAppEntities(savedSessions)
            }
        }

        // Selected-meet schedule sessions (public, scoped to the meet the app
        // currently mirrors for widgets/shortcuts).
        if !selectedMeet.isEmpty {
            let sessions = await SessionQuery.sessions(forMeet: selectedMeet)
            if !sessions.isEmpty {
                if #available(iOS 18.4, *) {
                    try? await index.indexAppEntities(sessions.map(SemanticSessionEntity.init))
                } else {
                    try? await index.indexAppEntities(sessions)
                }
            }
        }

        // Upcoming meets (public).
        if let apiMeets = try? await MeetCalAPI.shared.meets() {
            let meets = apiMeets.prefix(25).map { MeetEntity(api: $0) }
            if !meets.isEmpty {
                if #available(iOS 18.4, *) {
                    try? await index.indexAppEntities(meets.map(SemanticMeetEntity.init))
                } else {
                    try? await index.indexAppEntities(Array(meets))
                }
            }
        }
    }
}

#else

enum SemanticIndexDonator {
    static func donateAll() async {}
}

#endif
