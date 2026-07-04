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
                "Show weightlifting meets in \(.applicationName)",
                "Show me meets in \(.applicationName)",
                "Show meets in \(.applicationName)",
                "Show upcoming meets in \(.applicationName)",
                "What meets are coming up in \(.applicationName)",
                "What meets are in \(.applicationName)",
                "List meets in \(.applicationName)",
                "Find weightlifting competitions in \(.applicationName)",
                "Upcoming meets in \(.applicationName)",
                "Meets in \(.applicationName)"
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
                "Open saved sessions in \(.applicationName)",
                "Show me my saved sessions in \(.applicationName)",
                "What are my saved sessions in \(.applicationName)",
                "What sessions have I saved in \(.applicationName)",
                "Get my saved sessions in \(.applicationName)",
                "My saved sessions in \(.applicationName)",
                "Saved sessions in \(.applicationName)"
            ],
            shortTitle: "Saved Sessions",
            systemImageName: "bookmark.fill"
        )

        AppShortcut(
            intent: SearchAthleteIntent(),
            phrases: [
                "Search for an athlete in \(.applicationName)",
                "Find an athlete in \(.applicationName)",
                "When does my athlete lift in \(.applicationName)",
                "Search an athlete in \(.applicationName)",
                "Look up an athlete in \(.applicationName)",
                "Find a lifter in \(.applicationName)",
                "Search for a lifter in \(.applicationName)",
                "When does an athlete lift in \(.applicationName)",
                "What session is my athlete in \(.applicationName)",
                "Find athlete in \(.applicationName)",
                "Search athlete in \(.applicationName)"
            ],
            shortTitle: "Search Athlete",
            systemImageName: "person.fill"
        )

        AppShortcut(
            intent: GetSessionScheduleIntent(),
            phrases: [
                "Show the session schedule in \(.applicationName)",
                "Show the schedule in \(.applicationName)",
                "What's the session schedule in \(.applicationName)",
                "Show me the schedule in \(.applicationName)",
                "Get the session schedule in \(.applicationName)",
                "What's the schedule in \(.applicationName)",
                "When are the sessions in \(.applicationName)",
                "Show session times in \(.applicationName)",
                "Session schedule in \(.applicationName)",
                "Schedule in \(.applicationName)"
            ],
            shortTitle: "Session Schedule",
            systemImageName: "calendar"
        )

        AppShortcut(
            intent: GetAthleteResultsIntent(),
            phrases: [
                "Get athlete results in \(.applicationName)",
                "Show athlete results in \(.applicationName)",
                "Show me athlete results in \(.applicationName)",
                "Look up athlete results in \(.applicationName)",
                "What are an athlete's results in \(.applicationName)",
                "Get a lifter's results in \(.applicationName)",
                "Show a lifter's results in \(.applicationName)",
                "What are my athlete's best lifts in \(.applicationName)",
                "Athlete results in \(.applicationName)",
                "Get results in \(.applicationName)"
            ],
            shortTitle: "Athlete Results",
            systemImageName: "trophy.fill"
        )

        AppShortcut(
            intent: GetQualifyingTotalsIntent(),
            phrases: [
                "Show qualifying totals in \(.applicationName)",
                "Get qualifying totals in \(.applicationName)",
                "Show me qualifying totals in \(.applicationName)",
                "What are the qualifying totals in \(.applicationName)",
                "What's the qualifying total in \(.applicationName)",
                "Get qualifying total in \(.applicationName)",
                "Qualifying totals in \(.applicationName)",
                "Quali totals in \(.applicationName)"
            ],
            shortTitle: "Qualifying Totals",
            systemImageName: "target"
        )

        AppShortcut(
            intent: GetStandardsIntent(),
            phrases: [
                "Show standards in \(.applicationName)",
                "Get A B standards in \(.applicationName)",
                "Show me the standards in \(.applicationName)",
                "Get standards in \(.applicationName)",
                "What are the standards in \(.applicationName)",
                "Show A and B standards in \(.applicationName)",
                "What are the A and B standards in \(.applicationName)",
                "Standards in \(.applicationName)"
            ],
            shortTitle: "Standards",
            systemImageName: "chart.bar"
        )

        AppShortcut(
            intent: GetRankingsIntent(),
            phrases: [
                "Show rankings in \(.applicationName)",
                "Get international rankings in \(.applicationName)",
                "Show me the rankings in \(.applicationName)",
                "Get rankings in \(.applicationName)",
                "What are the rankings in \(.applicationName)",
                "Show international rankings in \(.applicationName)",
                "What are the international rankings in \(.applicationName)",
                "Rankings in \(.applicationName)"
            ],
            shortTitle: "Rankings",
            systemImageName: "globe.americas.fill"
        )

        AppShortcut(
            intent: GetRecordsIntent(),
            phrases: [
                "Show records in \(.applicationName)",
                "Get weightlifting records in \(.applicationName)",
                "Show me the records in \(.applicationName)",
                "Get records in \(.applicationName)",
                "What are the records in \(.applicationName)",
                "Show weightlifting records in \(.applicationName)",
                "What are the weightlifting records in \(.applicationName)",
                "Records in \(.applicationName)"
            ],
            shortTitle: "Records",
            systemImageName: "medal.fill"
        )
    }
}
