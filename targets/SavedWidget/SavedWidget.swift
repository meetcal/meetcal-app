//
//  SavedWidget.swift
//  SavedWidget
//
//  Created by Maddisen Mohnsen on 10/5/25.
//

import WidgetKit
import SwiftUI

/// How long a timeline may go without the app reloading it. The app calls
/// `WidgetCenter.reloadAllTimelines()` after every write, so this is only a
/// backstop for a reload that never arrived.
let meetCalTimelineBackstop: TimeInterval = 60 * 60

/// Upper bound on precomputed entries (one per upcoming session start).
let meetCalMaxSessionEntries = 24

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SimpleEntry {
        SimpleEntry(date: Date(), sessions: [], selectedMeet: "")
    }

    func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> ()) {
        let defaults = MeetCalShared.defaults
        let now = Date()
        completion(SimpleEntry(
            date: now,
            sessions: MeetCalShared.upcomingSavedSessions(in: defaults, at: now),
            selectedMeet: MeetCalShared.selectedMeet(in: defaults)
        ))
    }

    /// One entry now plus one at each upcoming session start, so a session
    /// drops off the widget the moment it starts without spending a reload.
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        let defaults = MeetCalShared.defaults
        let selectedMeet = MeetCalShared.selectedMeet(in: defaults)
        let sessions = MeetCalShared.allSavedSessions(in: defaults)
        let now = Date()

        let upcomingStarts = Array(
            Set(sessions.compactMap { $0.startAt }.filter { $0 > now })
        )
        .sorted()
        .prefix(meetCalMaxSessionEntries)

        var entries = [SimpleEntry(
            date: now,
            sessions: sessions.filter { !$0.hasStarted(at: now) },
            selectedMeet: selectedMeet
        )]
        for start in upcomingStarts {
            entries.append(SimpleEntry(
                date: start,
                sessions: sessions.filter { !$0.hasStarted(at: start) },
                selectedMeet: selectedMeet
            ))
        }

        // Entries past the backstop are simply rebuilt by the next reload.
        let reloadDate = now.addingTimeInterval(meetCalTimelineBackstop)
        completion(Timeline(entries: entries, policy: .after(reloadDate)))
    }
}

struct SimpleEntry: TimelineEntry {
    let date: Date
    let sessions: [WidgetSession]
    let selectedMeet: String
}

struct DataWidgetEntry: TimelineEntry {
    let date: Date
    let payload: DataWidgetPayload
}

struct DataWidgetProvider: TimelineProvider {
    let defaultsKey: String
    let fallbackPayload: DataWidgetPayload

    func placeholder(in context: Context) -> DataWidgetEntry {
        DataWidgetEntry(date: Date(), payload: fallbackPayload)
    }

    func getSnapshot(in context: Context, completion: @escaping (DataWidgetEntry) -> ()) {
        completion(loadEntry())
    }

    /// The payload only changes when the app writes it, and the app reloads
    /// the timelines when it does; the backstop covers a missed reload.
    func getTimeline(in context: Context, completion: @escaping (Timeline<DataWidgetEntry>) -> ()) {
        let entry = loadEntry()
        let refreshDate = Date().addingTimeInterval(meetCalTimelineBackstop)
        completion(Timeline(entries: [entry], policy: .after(refreshDate)))
    }

    private func loadEntry() -> DataWidgetEntry {
        let payload = MeetCalShared.dataPayload(forKey: defaultsKey) ?? fallbackPayload
        return DataWidgetEntry(date: Date(), payload: payload)
    }
}

struct Platform: View {
    let text: String

    func platformColor() -> Color {
        if text == "Red" {
            return Color.red
        } else if text == "White" {
            return Color.gray
        } else if text == "Stars" {
            return Color.indigo
        } else if text == "Stripes" {
            return Color.green
        } else if text == "Rogue" {
            return Color.black
        } else {
            return Color.blue
        }
    }

    var body: some View {
        Text(text)
            .frame(width: 45, height: 20)
            .font(.caption)
            .padding(.horizontal, 10)
            .background(platformColor())
            .foregroundStyle(.white)
            .cornerRadius(10)
    }
}

struct SessionView: View {
    var session: WidgetSession

    var body: some View {
        HStack {
            Platform(text: session.platform)
            VStack(alignment: .leading, spacing: 2) {
                Text("Session \(session.sessionNumber) • \(session.formattedStartTime)")
                    .font(.caption)
                    .bold()
                Text(session.detailLine)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.bottom, 2)
    }
}

func sessionDeepLink(_ session: WidgetSession, selectedMeet: String) -> URL? {
    if let url = session.url, let parsed = URL(string: url) {
        return parsed
    }
    return MeetCalDeepLinks.sessionDetails(
        id: session.id,
        meet: session.meet ?? selectedMeet,
        sessionNumber: session.sessionNumber,
        platform: session.platform,
        weightClass: session.weightClass,
        startTime: session.startTime,
        weighInTime: session.weighInTime,
        date: session.date
    )
}

@ViewBuilder
func linkedSessionView(_ session: WidgetSession, selectedMeet: String) -> some View {
    if let url = sessionDeepLink(session, selectedMeet: selectedMeet) {
        Link(destination: url) {
            SessionView(session: session)
        }
    } else {
        SessionView(session: session)
    }
}

struct MediumWidgetView: View {
    var entry: Provider.Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "calendar")
                    .foregroundStyle(.blue)
                Text(entry.selectedMeet.isEmpty ? "MeetCal" : entry.selectedMeet)
                    .font(.caption)
                    .bold()
                    .foregroundStyle(.blue)
                    .lineLimit(1)
                Spacer()
                Spacer()
            }
            .padding(.top)

            Divider()

            if entry.sessions.isEmpty {
                Text("No saved sessions")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            } else {
                ForEach(entry.sessions.prefix(3).indices, id: \.self) { index in
                    linkedSessionView(entry.sessions[index], selectedMeet: entry.selectedMeet)
                }
                Spacer()
            }
        }
    }
}

struct LargeWidgetView: View {
    var entry: Provider.Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "calendar")
                    .foregroundStyle(.blue)
                Text(entry.selectedMeet.isEmpty ? "MeetCal" : entry.selectedMeet)
                    .font(.caption)
                    .bold()
                    .foregroundStyle(.blue)
                    .lineLimit(1)
                Spacer()
                Spacer()
            }
            .padding(.top)

            Divider()

            if entry.sessions.isEmpty {
                Text("No saved sessions")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            } else {
                ForEach(entry.sessions.prefix(7).indices, id: \.self) { index in
                    linkedSessionView(entry.sessions[index], selectedMeet: entry.selectedMeet)
                }
                Spacer()
            }
        }
    }
}

struct DataWidgetRowView: View {
    let row: DataWidgetRow
    var centerTitle: Bool = false

    private var leadingChip: some View {
        Text(row.leading)
            .frame(width: 38, height: 21)
            .font(.caption2.weight(.semibold))
            .bold()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .background(Color.blue)
            .foregroundStyle(.white)
            .cornerRadius(11)
    }

    private var titleBlock: some View {
        VStack(alignment: centerTitle ? .center : .leading, spacing: 2) {
            if !row.title.isEmpty {
                Text(row.title)
                    .font(.caption2)
                    .bold()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            if let subtitle = row.subtitle, !subtitle.isEmpty {
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
        }
    }

    private var trailingText: some View {
        Text(row.trailing)
            .font(.caption2)
            .bold()
            .lineLimit(1)
            .minimumScaleFactor(0.65)
            .fixedSize(horizontal: false, vertical: true)
    }

    var body: some View {
        if centerTitle {
            HStack(alignment: .center, spacing: 6) {
                HStack(spacing: 0) {
                    leadingChip
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity)

                titleBlock

                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    trailingText
                }
                .frame(maxWidth: .infinity)
            }
            .padding(.bottom, 2)
        } else {
            HStack(alignment: .center, spacing: 6) {
                leadingChip

                if !row.title.isEmpty || !(row.subtitle?.isEmpty ?? true) {
                    titleBlock
                        .layoutPriority(1)
                }

                Spacer(minLength: 3)

                trailingText
                    .layoutPriority(2)
            }
            .padding(.bottom, 2)
        }
    }
}

struct LargeDataWidgetView: View {
    let entry: DataWidgetEntry
    let systemImage: String
    var centerTitle: Bool = false
    @Environment(\.widgetFamily) var family

    private var rowLimit: Int {
        let maxRows = entry.payload.maxRows ?? 7
        return family == .systemMedium ? min(maxRows, 3) : maxRows
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: systemImage)
                    .foregroundStyle(.blue)
                VStack(alignment: .leading, spacing: 1) {
                    Text(entry.payload.title)
                        .font(.caption)
                        .bold()
                        .foregroundStyle(.blue)
                        .lineLimit(1)
                    Text(entry.payload.subtitle)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                Spacer()
            }
            .padding(.top)

            Divider()

            if entry.payload.rows.isEmpty {
                Text(entry.payload.emptyMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Spacer()
            } else {
                ForEach(entry.payload.rows.prefix(rowLimit), id: \.self) { row in
                    DataWidgetRowView(row: row, centerTitle: centerTitle)
                }
                Spacer()
            }
        }
    }
}

struct SavedWidgetEntryView: View {
    var entry: Provider.Entry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .systemMedium:
            MediumWidgetView(entry: entry)
        case .systemLarge:
            LargeWidgetView(entry: entry)
        default:
            MediumWidgetView(entry: entry)
        }
    }
}

struct SavedWidget: Widget {
    let kind: String = "SavedWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            SavedWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(MeetCalDeepLinks.saved)
        }
        .configurationDisplayName("Saved Sessions")
        .description("Get a quick glance at your saved sessions.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct QualifyingTotalsWidget: Widget {
    let kind: String = "QualifyingTotalsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: kind,
            provider: DataWidgetProvider(
                defaultsKey: MeetCalShared.Key.qualifyingTotals,
                fallbackPayload: DataWidgetPayload(
                    title: "Qualifying Totals",
                    subtitle: "Open MeetCal to choose filters",
                    emptyMessage: "No qualifying totals",
                    linkURL: MeetCalDeepLinks.qualifyingTotals.absoluteString,
                    maxRows: 10,
                    rows: []
                )
            )
        ) { entry in
            LargeDataWidgetView(entry: entry, systemImage: "target")
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: entry.payload.linkURL ?? "") ?? MeetCalDeepLinks.qualifyingTotals)
        }
        .configurationDisplayName("Qualifying Totals")
        .description("See qualifying totals for your selected event.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct StandardsWidget: Widget {
    let kind: String = "StandardsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: kind,
            provider: DataWidgetProvider(
                defaultsKey: MeetCalShared.Key.standards,
                fallbackPayload: DataWidgetPayload(
                    title: "A/B Standards",
                    subtitle: "Open MeetCal to choose filters",
                    emptyMessage: "No standards",
                    linkURL: MeetCalDeepLinks.standards.absoluteString,
                    maxRows: 10,
                    rows: []
                )
            )
        ) { entry in
            LargeDataWidgetView(entry: entry, systemImage: "chart.bar", centerTitle: true)
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: entry.payload.linkURL ?? "") ?? MeetCalDeepLinks.standards)
        }
        .configurationDisplayName("A/B Standards")
        .description("See USA Weightlifting A/B standards.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct InternationalRankingsWidget: Widget {
    let kind: String = "InternationalRankingsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: kind,
            provider: DataWidgetProvider(
                defaultsKey: MeetCalShared.Key.intlRankings,
                fallbackPayload: DataWidgetPayload(
                    title: "International Rankings",
                    subtitle: "Open MeetCal to choose filters",
                    emptyMessage: "No rankings",
                    linkURL: MeetCalDeepLinks.rankings.absoluteString,
                    maxRows: 7,
                    rows: []
                )
            )
        ) { entry in
            LargeDataWidgetView(entry: entry, systemImage: "globe.americas")
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: entry.payload.linkURL ?? "") ?? MeetCalDeepLinks.rankings)
        }
        .configurationDisplayName("International Rankings")
        .description("See international rankings for your selected filters.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

@main
struct SavedWidgetBundle: WidgetBundle {
    var body: some Widget {
        SavedWidget()
        QualifyingTotalsWidget()
        StandardsWidget()
        InternationalRankingsWidget()
    }
}

#Preview(as: .systemMedium) {
    SavedWidget()
} timeline: {
    SimpleEntry(
        date: .now,
        sessions: [
            WidgetSession(platform: "Red", sessionNumber: 1, startTime: "8:00 AM", weightClass: "M81", date: "2025-10-04"),
            WidgetSession(platform: "Blue", sessionNumber: 2, startTime: "10:30 AM", weightClass: "W71", date: "2025-10-04"),
            WidgetSession(platform: "Stars", sessionNumber: 3, startTime: "2:00 PM", weightClass: "M102", date: "2025-10-04")
        ],
        selectedMeet: "2025 New England WSO Championships"
    )
}

#Preview(as: .systemLarge) {
    SavedWidget()
} timeline: {
    SimpleEntry(
        date: .now,
        sessions: [
            WidgetSession(platform: "Red", sessionNumber: 1, startTime: "8:00 AM", weightClass: "M81", date: "2025-10-04"),
            WidgetSession(platform: "Blue", sessionNumber: 2, startTime: "10:30 AM", weightClass: "W71", date: "2025-10-04"),
            WidgetSession(platform: "Stars", sessionNumber: 3, startTime: "2:00 PM", weightClass: "M102", date: "2025-10-04"),
            WidgetSession(platform: "White", sessionNumber: 4, startTime: "4:00 PM", weightClass: "W59", date: "2025-10-04"),
            WidgetSession(platform: "Stripes", sessionNumber: 5, startTime: "6:30 PM", weightClass: "M89", date: "2025-10-04"),
            WidgetSession(platform: "Rogue", sessionNumber: 6, startTime: "8:00 PM", weightClass: "W76", date: "2025-10-04"),
            WidgetSession(platform: "Red", sessionNumber: 7, startTime: "9:00 AM", weightClass: "M73", date: "2025-10-04"),
            WidgetSession(platform: "Blue", sessionNumber: 8, startTime: "12:00 PM", weightClass: "W64", date: "2025-10-04"),
            WidgetSession(platform: "Stars", sessionNumber: 9, startTime: "3:30 PM", weightClass: "M96", date: "2025-10-04")
        ],
        selectedMeet: "2025 New England WSO Championships"
    )
}
