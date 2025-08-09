import WidgetKit
import SwiftUI

struct MeetCalSmallWidget: Widget {
    let kind: String = "MeetCalSmallWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SmallWidgetTimelineProvider()) { entry in
            SmallWidgetView(entry: entry)
        }
        .configurationDisplayName("Select Meet")
        .description("Select a meet to view its schedule")
        .supportedFamilies([.systemSmall])
    }
}

struct SmallWidgetEntry: TimelineEntry {
    let date: Date
    let meets: [Meet]
    let selectedMeet: String?
}

struct Meet: Codable, Hashable {
    let name: String
    let status: String
}

struct SmallWidgetTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> SmallWidgetEntry {
        SmallWidgetEntry(
            date: Date(),
            meets: [Meet(name: "Loading...", status: "upcoming")],
            selectedMeet: nil
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (SmallWidgetEntry) -> ()) {
        let entry = SmallWidgetEntry(
            date: Date(),
            meets: loadMeets(),
            selectedMeet: loadSelectedMeet()
        )
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        let currentDate = Date()
        let entryDate = Calendar.current.date(byAdding: .minute, value: 15, to: currentDate)!
        
        let entry = SmallWidgetEntry(
            date: currentDate,
            meets: loadMeets(),
            selectedMeet: loadSelectedMeet()
        )

        let timeline = Timeline(entries: [entry], policy: .after(entryDate))
        completion(timeline)
    }
    
    private func loadMeets() -> [Meet] {
        if let userDefaults = UserDefaults(suiteName: "group.com.memohnsen.meetcal.widgets"),
           let data = userDefaults.data(forKey: "available_meets"),
           let meets = try? JSONDecoder().decode([Meet].self, from: data) {
            return meets
        }
        return [Meet(name: "No meets available", status: "")]
    }
    
    private func loadSelectedMeet() -> String? {
        if let userDefaults = UserDefaults(suiteName: "group.com.memohnsen.meetcal.widgets") {
            return userDefaults.string(forKey: "selected_meet")
        }
        return nil
    }
}

struct SmallWidgetView: View {
    var entry: SmallWidgetTimelineProvider.Entry
    
    var body: some View {
        VStack(spacing: 8) {
                // App icon/logo
                Image(systemName: "calendar.badge.plus")
                    .font(.title2)
                    .foregroundColor(.blue)
                
                // App name
                Text("MeetCal")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)
                
                // Selected meet or prompt
                if let selectedMeet = entry.selectedMeet {
                    Text(selectedMeet)
                        .font(.caption2)
                        .fontWeight(.medium)
                        .foregroundColor(.blue)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                } else if !entry.meets.isEmpty && entry.meets.first?.name != "No meets available" {
                    Text("Tap to select meet")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                } else {
                    Text("No meets")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.regularMaterial)
        .widgetURL(URL(string: "meetcal://select-meet"))
    }
}

// Preview removed - requires iOS 17.0+