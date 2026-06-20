//
//  SavedWidget.swift
//  SavedWidget
//
//  Created by Maddisen Mohnsen on 10/5/25.
//

import WidgetKit
import SwiftUI

let meetCalSavedDeepLink = URL(string: "meetcal:///open/saved")
let meetCalQualifyingTotalsDeepLink = URL(string: "meetcal:///comp-data/new-qualifying-totals")
let meetCalStandardsDeepLink = URL(string: "meetcal:///comp-data/new-standards")
let meetCalIntlRankingsDeepLink = URL(string: "meetcal:///comp-data/rankings")

extension UserDefaults {
    static var appGroup: UserDefaults {
        UserDefaults(suiteName: "group.com.memohnsen.meetcal") ?? .standard
    }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SimpleEntry {
        SimpleEntry(date: Date(), sessions: [], selectedMeet: "")
    }

    func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> ()) {
        let entry = loadEntry()
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        let entry = loadEntry()
        // Refresh every 5 minutes to pick up changes from the app
        let refreshDate = Calendar.current.date(byAdding: .minute, value: 5, to: Date()) ?? Date()
        let timeline = Timeline(entries: [entry], policy: .after(refreshDate))
        completion(timeline)
    }

    private func loadEntry() -> SimpleEntry {
        print("Widget: loadEntry called")

        let sharedDefaults = UserDefaults.appGroup
        let selectedMeet = sharedDefaults.string(forKey: "selectedMeet") ?? ""
        print("Widget: selectedMeet = \(selectedMeet)")

        guard let savedSessionsData = sharedDefaults.data(forKey: "savedSessions") else {
            print("Widget: No saved sessions data found")
            return SimpleEntry(date: Date(), sessions: [], selectedMeet: selectedMeet)
        }

        let decoder = JSONDecoder()
        guard let savedSessions = try? decoder.decode([SessionsRowForWidget].self, from: savedSessionsData) else {
            print("Widget: Failed to decode sessions")
            return SimpleEntry(date: Date(), sessions: [], selectedMeet: selectedMeet)
        }

        print("Widget: Decoded \(savedSessions.count) sessions")

        let widgetSessions = savedSessions
            .map { session in
                WidgetSession(
                    id: session.id,
                    meet: session.meet,
                    platform: session.platform,
                    sessionNumber: session.session_number,
                    startTime: session.start_time,
                    weighInTime: session.weigh_in_time,
                    weightClass: session.weight_class,
                    date: session.date,
                    url: session.url
                )
            }
            .filter { !$0.isPast }

        return SimpleEntry(date: Date(), sessions: widgetSessions, selectedMeet: selectedMeet)
    }
}

struct SessionsRowForWidget: Codable {
    let id: String?
    let meet: String?
    let platform: String
    let session_number: Int
    let start_time: String
    let weigh_in_time: String?
    let weight_class: String
    let date: String
    let url: String?
}

struct WidgetSession: Codable {
    let id: String?
    let meet: String?
    let platform: String
    let sessionNumber: Int
    let startTime: String
    let weighInTime: String?
    let weightClass: String
    let date: String
    let url: String?

    init(
        id: String? = nil,
        meet: String? = nil,
        platform: String,
        sessionNumber: Int,
        startTime: String,
        weighInTime: String? = nil,
        weightClass: String,
        date: String,
        url: String? = nil
    ) {
        self.id = id
        self.meet = meet
        self.platform = platform
        self.sessionNumber = sessionNumber
        self.startTime = startTime
        self.weighInTime = weighInTime
        self.weightClass = weightClass
        self.date = date
        self.url = url
    }

    var formattedStartTime: String {
        let inputFormatter = DateFormatter()
        inputFormatter.dateFormat = "HH:mm:ss"
        inputFormatter.locale = Locale(identifier: "en_US_POSIX")

        let outputFormatter = DateFormatter()
        outputFormatter.dateStyle = .none
        outputFormatter.timeStyle = .short
        outputFormatter.locale = Locale(identifier: "en_US")

        if let time = inputFormatter.date(from: startTime) {
            return outputFormatter.string(from: time)
        }
        return startTime
    }

    var sessionDateTime: Date? {
        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")

        guard let sessionDate = dateFormatter.date(from: date) else {
            return nil
        }

        let timeFormatter = DateFormatter()
        timeFormatter.dateFormat = "HH:mm:ss"
        timeFormatter.locale = Locale(identifier: "en_US_POSIX")

        guard let timeDate = timeFormatter.date(from: startTime) else {
            return nil
        }

        let calendar = Calendar.current
        let dateComponents = calendar.dateComponents([.year, .month, .day], from: sessionDate)
        let timeComponents = calendar.dateComponents([.hour, .minute, .second], from: timeDate)

        var combinedComponents = DateComponents()
        combinedComponents.year = dateComponents.year
        combinedComponents.month = dateComponents.month
        combinedComponents.day = dateComponents.day
        combinedComponents.hour = timeComponents.hour
        combinedComponents.minute = timeComponents.minute
        combinedComponents.second = timeComponents.second

        return calendar.date(from: combinedComponents)
    }

    var isPast: Bool {
        guard let sessionDateTime = sessionDateTime else {
            return false
        }
        return sessionDateTime < Date()
    }
}

struct SimpleEntry: TimelineEntry {
    let date: Date
    let sessions: [WidgetSession]
    let selectedMeet: String
}

struct DataWidgetRow: Codable, Hashable {
    let leading: String
    let title: String
    let trailing: String
    let subtitle: String?
}

struct DataWidgetPayload: Codable {
    let title: String
    let subtitle: String
    let emptyMessage: String
    let linkURL: String?
    let maxRows: Int?
    let rows: [DataWidgetRow]
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

    func getTimeline(in context: Context, completion: @escaping (Timeline<DataWidgetEntry>) -> ()) {
        let entry = loadEntry()
        let refreshDate = Calendar.current.date(byAdding: .minute, value: 5, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(refreshDate)))
    }

    private func loadEntry() -> DataWidgetEntry {
        let sharedDefaults = UserDefaults.appGroup
        guard let data = sharedDefaults.data(forKey: defaultsKey),
              let payload = try? JSONDecoder().decode(DataWidgetPayload.self, from: data) else {
            return DataWidgetEntry(date: Date(), payload: fallbackPayload)
        }

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
                Text("\(session.weightClass)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
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

    var components = URLComponents()
    components.scheme = "meetcal"
    components.host = ""
    components.path = "/shared-screens/schedule-details"
    components.queryItems = [
        URLQueryItem(name: "id", value: session.id),
        URLQueryItem(name: "meet", value: session.meet ?? selectedMeet),
        URLQueryItem(name: "sessionNumber", value: String(session.sessionNumber)),
        URLQueryItem(name: "platform", value: session.platform),
        URLQueryItem(name: "weightClass", value: session.weightClass),
        URLQueryItem(name: "startTime", value: session.startTime),
        URLQueryItem(name: "weighInTime", value: session.weighInTime),
        URLQueryItem(name: "date", value: session.date)
    ].filter { item in
        guard let value = item.value else { return false }
        return !value.isEmpty
    }
    return components.url
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

    var body: some View {
        HStack(alignment: .center, spacing: 6) {
            Text(row.leading)
                .frame(width: 38, height: 21)
                .font(.caption2.weight(.semibold))
                .bold()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .background(Color.blue)
                .foregroundStyle(.white)
                .cornerRadius(11)

            if !row.title.isEmpty || !(row.subtitle?.isEmpty ?? true) {
                VStack(alignment: .leading, spacing: 2) {
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
                .layoutPriority(1)
            }

            Spacer(minLength: 3)

            Text(row.trailing)
                .font(.caption2)
                .bold()
                .lineLimit(1)
                .minimumScaleFactor(0.65)
                .fixedSize(horizontal: false, vertical: true)
                .layoutPriority(2)
        }
        .padding(.bottom, 2)
    }
}

struct LargeDataWidgetView: View {
    let entry: DataWidgetEntry
    let systemImage: String

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
                ForEach(entry.payload.rows.prefix(entry.payload.maxRows ?? 7), id: \.self) { row in
                    DataWidgetRowView(row: row)
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
                .widgetURL(meetCalSavedDeepLink)
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
                defaultsKey: "qualifyingTotalsWidgetData",
                fallbackPayload: DataWidgetPayload(
                    title: "Qualifying Totals",
                    subtitle: "Open MeetCal to choose filters",
                    emptyMessage: "No qualifying totals",
                    linkURL: meetCalQualifyingTotalsDeepLink?.absoluteString,
                    maxRows: 10,
                    rows: []
                )
            )
        ) { entry in
            LargeDataWidgetView(entry: entry, systemImage: "target")
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: entry.payload.linkURL ?? "") ?? meetCalQualifyingTotalsDeepLink)
        }
        .configurationDisplayName("Qualifying Totals")
        .description("See qualifying totals for your selected event.")
        .supportedFamilies([.systemLarge])
    }
}

struct StandardsWidget: Widget {
    let kind: String = "StandardsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: kind,
            provider: DataWidgetProvider(
                defaultsKey: "standardsWidgetData",
                fallbackPayload: DataWidgetPayload(
                    title: "A/B Standards",
                    subtitle: "Open MeetCal to choose filters",
                    emptyMessage: "No standards",
                    linkURL: meetCalStandardsDeepLink?.absoluteString,
                    maxRows: 10,
                    rows: []
                )
            )
        ) { entry in
            LargeDataWidgetView(entry: entry, systemImage: "chart.bar")
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: entry.payload.linkURL ?? "") ?? meetCalStandardsDeepLink)
        }
        .configurationDisplayName("A/B Standards")
        .description("See USA Weightlifting A/B standards.")
        .supportedFamilies([.systemLarge])
    }
}

struct InternationalRankingsWidget: Widget {
    let kind: String = "InternationalRankingsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: kind,
            provider: DataWidgetProvider(
                defaultsKey: "intlRankingsWidgetData",
                fallbackPayload: DataWidgetPayload(
                    title: "International Rankings",
                    subtitle: "Open MeetCal to choose filters",
                    emptyMessage: "No rankings",
                    linkURL: meetCalIntlRankingsDeepLink?.absoluteString,
                    maxRows: 7,
                    rows: []
                )
            )
        ) { entry in
            LargeDataWidgetView(entry: entry, systemImage: "globe.americas")
                .containerBackground(.fill.tertiary, for: .widget)
                .widgetURL(URL(string: entry.payload.linkURL ?? "") ?? meetCalIntlRankingsDeepLink)
        }
        .configurationDisplayName("International Rankings")
        .description("See international rankings for your selected filters.")
        .supportedFamilies([.systemLarge])
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
            WidgetSession(platform: "Red", sessionNumber: 1, startTime: "08:00:00", weightClass: "M81", date: "2025-10-04"),
            WidgetSession(platform: "Blue", sessionNumber: 2, startTime: "10:30:00", weightClass: "W71", date: "2025-10-04"),
            WidgetSession(platform: "Stars", sessionNumber: 3, startTime: "14:00:00", weightClass: "M102", date: "2025-10-04")
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
            WidgetSession(platform: "Red", sessionNumber: 1, startTime: "08:00:00", weightClass: "M81", date: "2025-10-04"),
            WidgetSession(platform: "Blue", sessionNumber: 2, startTime: "10:30:00", weightClass: "W71", date: "2025-10-04"),
            WidgetSession(platform: "Stars", sessionNumber: 3, startTime: "14:00:00", weightClass: "M102", date: "2025-10-04"),
            WidgetSession(platform: "White", sessionNumber: 4, startTime: "16:00:00", weightClass: "W59", date: "2025-10-04"),
            WidgetSession(platform: "Stripes", sessionNumber: 5, startTime: "18:30:00", weightClass: "M89", date: "2025-10-04"),
            WidgetSession(platform: "Rogue", sessionNumber: 6, startTime: "20:00:00", weightClass: "W76", date: "2025-10-04"),
            WidgetSession(platform: "Red", sessionNumber: 7, startTime: "09:00:00", weightClass: "M73", date: "2025-10-04"),
            WidgetSession(platform: "Blue", sessionNumber: 8, startTime: "12:00:00", weightClass: "W64", date: "2025-10-04"),
            WidgetSession(platform: "Stars", sessionNumber: 9, startTime: "15:30:00", weightClass: "M96", date: "2025-10-04")
        ],
        selectedMeet: "2025 New England WSO Championships"
    )
}
