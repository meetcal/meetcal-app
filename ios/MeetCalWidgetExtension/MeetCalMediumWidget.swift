import WidgetKit
import SwiftUI

struct MeetCalMediumWidget: Widget {
    let kind: String = "MeetCalMediumWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: MediumWidgetTimelineProvider()) { entry in
            MediumWidgetView(entry: entry)
        }
        .configurationDisplayName("Saved Sessions")
        .description("View your upcoming saved sessions")
        .supportedFamilies([.systemMedium])
    }
}

struct MediumWidgetEntry: TimelineEntry {
    let date: Date
    let selectedMeet: String?
    let savedSessions: [SavedSession]
}

struct SavedSession: Codable, Hashable {
    let id: String
    let meet: String
    let sessionNumber: Int
    let platform: String
    let weightClass: String
    let startTime: String
    let date: String
    let athleteNames: [String]?
}

struct MediumWidgetTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> MediumWidgetEntry {
        MediumWidgetEntry(
            date: Date(),
            selectedMeet: "Loading...",
            savedSessions: []
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (MediumWidgetEntry) -> ()) {
        let entry = MediumWidgetEntry(
            date: Date(),
            selectedMeet: loadSelectedMeet(),
            savedSessions: loadSavedSessions()
        )
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        let currentDate = Date()
        let entryDate = Calendar.current.date(byAdding: .minute, value: 15, to: currentDate)!
        
        let entry = MediumWidgetEntry(
            date: currentDate,
            selectedMeet: loadSelectedMeet(),
            savedSessions: loadSavedSessions()
        )

        let timeline = Timeline(entries: [entry], policy: .after(entryDate))
        completion(timeline)
    }
    
    private func loadSelectedMeet() -> String? {
        if let userDefaults = UserDefaults(suiteName: "group.com.memohnsen.meetcal.widgets") {
            return userDefaults.string(forKey: "selected_meet")
        }
        return nil
    }
    
    private func loadSavedSessions() -> [SavedSession] {
        if let userDefaults = UserDefaults(suiteName: "group.com.memohnsen.meetcal.widgets"),
           let data = userDefaults.data(forKey: "saved_sessions"),
           let sessions = try? JSONDecoder().decode([SavedSession].self, from: data) {
            
            // Filter for current selected meet and upcoming sessions
            guard let selectedMeet = loadSelectedMeet() else { return [] }
            
            let currentDate = Date()
            let dateFormatter = DateFormatter()
            dateFormatter.dateFormat = "yyyy-MM-dd"
            
            return sessions
                .filter { $0.meet == selectedMeet }
                .filter { session in
                    if let sessionDate = dateFormatter.date(from: session.date) {
                        return sessionDate >= currentDate
                    }
                    return false
                }
                .sorted { session1, session2 in
                    let date1 = dateFormatter.date(from: session1.date) ?? Date.distantFuture
                    let date2 = dateFormatter.date(from: session2.date) ?? Date.distantFuture
                    return date1 < date2
                }
        }
        return []
    }
}

struct MediumWidgetView: View {
    var entry: MediumWidgetTimelineProvider.Entry
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
                // Header
                HStack {
                    Image(systemName: "calendar.badge.plus")
                        .font(.title3)
                        .foregroundColor(.blue)
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text("MeetCal")
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(.primary)
                        
                        if let selectedMeet = entry.selectedMeet {
                            Text(selectedMeet)
                                .font(.caption2)
                                .foregroundColor(.blue)
                                .lineLimit(1)
                        }
                    }
                    
                    Spacer()
                }
                
                Divider()
                    .background(Color.secondary.opacity(0.3))
                
                // Sessions list
                if entry.savedSessions.isEmpty {
                    VStack {
                        Spacer()
                        Text("No saved sessions")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                        Spacer()
                    }
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Upcoming Sessions")
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundColor(.primary)
                        
                        ForEach(Array(entry.savedSessions.prefix(3)), id: \.id) { session in
                            SessionRowView(session: session)
                        }
                        
                        if entry.savedSessions.count > 3 {
                            Text("+ \(entry.savedSessions.count - 3) more")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                
                Spacer()
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(.regularMaterial)
        .widgetURL(URL(string: "meetcal://saved-sessions"))
    }
}

struct SessionRowView: View {
    let session: SavedSession
    
    private var platformColor: Color {
        switch session.platform.lowercased() {
        case "red": return .red
        case "white": return .gray
        case "blue": return .blue
        case "stars": return .purple
        case "stripes": return .orange
        case "rogue": return .green
        default: return .gray
        }
    }
    
    var body: some View {
        HStack(spacing: 8) {
            // Platform indicator
            RoundedRectangle(cornerRadius: 4)
                .fill(platformColor)
                .frame(width: 6, height: 24)
            
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text("Session \(session.sessionNumber)")
                        .font(.caption2)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)
                    
                    Text(session.platform)
                        .font(.caption2)
                        .foregroundColor(platformColor)
                    
                    Spacer()
                    
                    Text(session.startTime)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                
                Text(session.weightClass)
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.secondary.opacity(0.1))
        .cornerRadius(6)
    }
}

// Preview removed - requires iOS 17.0+