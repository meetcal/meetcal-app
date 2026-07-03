//
//  SemanticIndex.swift
//  MeetCal App Intents
//
//  Donates entities to the Spotlight index so Siri AI (iOS 27) can answer from
//  them. `IndexedEntity` + `CSSearchableIndex.indexAppEntities` exist since
//  iOS 18; the iOS 27-only semantic-indexing additions (`@Property(indexingKey:)`)
//  are gated with `if #available(iOS 27, *)` where used.
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
            try? await index.indexAppEntities(savedSessions)
        }

        // Upcoming meets (public).
        if let apiMeets = try? await MeetCalAPI.shared.meets() {
            let meets = apiMeets.prefix(25).map { MeetEntity(api: $0) }
            if !meets.isEmpty {
                try? await index.indexAppEntities(Array(meets))
            }
        }
    }
}

#else

enum SemanticIndexDonator {
    static func donateAll() async {}
}

#endif
