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
        let entryDate = Calendar.current.date(byAdding: .minute, value: 1, to: currentDate)!
        
        let entry = MediumWidgetEntry(
            date: currentDate,
            selectedMeet: loadSelectedMeet(),
            savedSessions: loadSavedSessions()
        )

        let timeline = Timeline(entries: [entry], policy: .after(entryDate))
        completion(timeline)
    }
    
    private func loadSelectedMeet() -> String? {
        if let userDefaults = UserDefaults(suiteName: "group.com.memohnsen.meetcal.expowidgets") {
            return userDefaults.string(forKey: "selected_meet")
        }
        return nil
    }
    
    private func platformPriority(_ platform: String) -> Int {
        switch platform.lowercased() {
        case "red":
            return 0
        case "white":
            return 1
        case "blue":
            return 2
        default:
            return 999 // Unknown platforms go last
        }
    }
    
    private func loadSavedSessions() -> [SavedSession] {
        if let userDefaults = UserDefaults(suiteName: "group.com.memohnsen.meetcal.expowidgets"),
           let data = userDefaults.data(forKey: "saved_sessions"),
           let sessions = try? JSONDecoder().decode([SavedSession].self, from: data) {
            
            print("Widget: Found \(sessions.count) saved sessions in UserDefaults")
            
            // For debugging, let's first show all sessions without filtering
            if sessions.isEmpty {
                print("Widget: No sessions found")
                return []
            }
            
            // Filter for current selected meet if available, otherwise show all
            let selectedMeet = loadSelectedMeet()
            print("Widget: Selected meet is: \(selectedMeet ?? "none")")
            
            var filteredSessions = sessions
            
            if let selectedMeet = selectedMeet, !selectedMeet.isEmpty {
                filteredSessions = sessions.filter { $0.meet == selectedMeet }
                print("Widget: After filtering by meet '\(selectedMeet)': \(filteredSessions.count) sessions")
            }
            
            // Be more lenient with date filtering - show sessions from today onwards
            let calendar = Calendar.current
            let today = calendar.startOfDay(for: Date())
            let dateFormatter = DateFormatter()
            dateFormatter.dateFormat = "yyyy-MM-dd"
            
            let upcomingSessions = filteredSessions.filter { session in
                if let sessionDate = dateFormatter.date(from: session.date) {
                    let sessionStartOfDay = calendar.startOfDay(for: sessionDate)
                    return sessionStartOfDay >= today
                }
                // If we can't parse the date, include the session
                return true
            }
            
            print("Widget: After date filtering: \(upcomingSessions.count) sessions")
            
            let sortedSessions = upcomingSessions.sorted { session1, session2 in
                // First sort by session number
                if session1.sessionNumber != session2.sessionNumber {
                    return session1.sessionNumber < session2.sessionNumber
                }
                
                // Then sort by platform: Red=0, White=1, Blue=2
                let platform1Priority = platformPriority(session1.platform)
                let platform2Priority = platformPriority(session2.platform)
                if platform1Priority != platform2Priority {
                    return platform1Priority < platform2Priority
                }
                
                // Finally sort by date if session number and platform are the same
                let date1 = dateFormatter.date(from: session1.date) ?? Date.distantFuture
                let date2 = dateFormatter.date(from: session2.date) ?? Date.distantFuture
                return date1 < date2
            }
            
            print("Widget: Returning \(sortedSessions.count) sessions")
            return Array(sortedSessions.prefix(10)) // Limit to 10 sessions
        }
        
        print("Widget: No UserDefaults data found for saved_sessions")
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
                        
                        ForEach(Array(entry.savedSessions.prefix(1)), id: \.id) { session in
                            SessionRowView(session: session)
                        }
                        
                        if entry.savedSessions.count > 1 {
                            Text("+ \(entry.savedSessions.count - 1) more")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
                
                Spacer()
            }
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
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