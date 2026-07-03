//
//  AppShortcuts.swift
//  MeetCal App Intents
//
//  Registers natural-language phrases so intents are invokable by Siri /
//  Spotlight / the Shortcuts app on iOS 18+ and discoverable by Siri AI on 27.
//  Phrases MUST include \(.applicationName).
//

import AppIntents

struct MeetCalAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: FindMeetsIntent(),
            phrases: [
                "Find meets in \(.applicationName)",
                "Find upcoming meets in \(.applicationName)",
                "Show weightlifting meets in \(.applicationName)"
            ],
            shortTitle: "Find Meets",
            systemImageName: "calendar"
        )

        AppShortcut(
            intent: ShowSavedSessionsIntent(),
            phrases: [
                "Show my saved sessions in \(.applicationName)",
                "Show saved sessions in \(.applicationName)",
                "What sessions did I save in \(.applicationName)",
                "Open my saved sessions in \(.applicationName)",
                "Open saved sessions in \(.applicationName)"
            ],
            shortTitle: "Saved Sessions",
            systemImageName: "bookmark.fill"
        )

        AppShortcut(
            intent: SearchAthleteIntent(),
            phrases: [
                "Search for an athlete in \(.applicationName)",
                "Find an athlete in \(.applicationName)",
                "When does my athlete lift in \(.applicationName)"
            ],
            shortTitle: "Search Athlete",
            systemImageName: "person.fill"
        )

        AppShortcut(
            intent: GetSessionScheduleIntent(),
            phrases: [
                "Show the session schedule in \(.applicationName)",
                "Show the schedule in \(.applicationName)",
                "What's the session schedule in \(.applicationName)"
            ],
            shortTitle: "Session Schedule",
            systemImageName: "calendar"
        )

        AppShortcut(
            intent: GetAthleteResultsIntent(),
            phrases: [
                "Get athlete results in \(.applicationName)",
                "Show athlete results in \(.applicationName)"
            ],
            shortTitle: "Athlete Results",
            systemImageName: "trophy.fill"
        )

        AppShortcut(
            intent: GetQualifyingTotalsIntent(),
            phrases: [
                "Show qualifying totals in \(.applicationName)",
                "Get qualifying totals in \(.applicationName)"
            ],
            shortTitle: "Qualifying Totals",
            systemImageName: "target"
        )

        AppShortcut(
            intent: GetStandardsIntent(),
            phrases: [
                "Show standards in \(.applicationName)",
                "Get A B standards in \(.applicationName)"
            ],
            shortTitle: "Standards",
            systemImageName: "chart.bar"
        )

        AppShortcut(
            intent: GetRankingsIntent(),
            phrases: [
                "Show rankings in \(.applicationName)",
                "Get international rankings in \(.applicationName)"
            ],
            shortTitle: "Rankings",
            systemImageName: "globe.americas.fill"
        )

        AppShortcut(
            intent: GetRecordsIntent(),
            phrases: [
                "Show records in \(.applicationName)",
                "Get weightlifting records in \(.applicationName)"
            ],
            shortTitle: "Records",
            systemImageName: "medal.fill"
        )

        AppShortcut(
            intent: OpenCompDataIntent(),
            phrases: [
                "Open competition data in \(.applicationName)",
                "Open records and standards in \(.applicationName)"
            ],
            shortTitle: "Open Data",
            systemImageName: "chart.bar.doc.horizontal"
        )
    }
}
