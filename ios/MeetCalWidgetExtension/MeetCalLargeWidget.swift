import WidgetKit
import SwiftUI

struct MeetCalLargeWidget: Widget {
    let kind: String = "MeetCalLargeWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: LargeWidgetTimelineProvider()) { entry in
            LargeWidgetView(entry: entry)
        }
        .configurationDisplayName("Saved Sessions")
        .description("View your upcoming saved sessions")
        .supportedFamilies([.systemLarge])
    }
}

struct LargeWidgetEntry: TimelineEntry {
    let date: Date
    let selectedMeet: String?
    let savedSessions: [SavedSession]
}

struct LargeWidgetTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> LargeWidgetEntry {
        LargeWidgetEntry(
            date: Date(),
            selectedMeet: "Loading...",
            savedSessions: []
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (LargeWidgetEntry) -> ()) {
        let entry = LargeWidgetEntry(
            date: Date(),
            selectedMeet: "2024 National Championships",
            savedSessions: [
                SavedSession(
                    id: "1",
                    meet: "2024 National Championships",
                    sessionNumber: 1,
                    platform: "Red",
                    weightClass: "Women 55kg A",
                    startTime: "9:00 AM",
                    date: "2024-12-20",
                    athleteNames: ["Alice Smith", "Jane Doe"]
                ),
                SavedSession(
                    id: "2",
                    meet: "2024 National Championships",
                    sessionNumber: 2,
                    platform: "Blue",
                    weightClass: "Men 73kg A",
                    startTime: "1:00 PM",
                    date: "2024-12-20",
                    athleteNames: ["John Smith"]
                )
            ]
        )
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> ()) {
        let currentDate = Date()
        let entryDate = Calendar.current.date(byAdding: .minute, value: 15, to: currentDate)!
        
        let entry = LargeWidgetEntry(
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
    
    private func loadSavedSessions() -> [SavedSession] {
        if let userDefaults = UserDefaults(suiteName: "group.com.memohnsen.meetcal.expowidgets"),
           let data = userDefaults.data(forKey: "saved_sessions"),
           let sessions = try? JSONDecoder().decode([SavedSession].self, from: data) {
            
            print("Large Widget: Found \(sessions.count) saved sessions in UserDefaults")
            
            // For debugging, let's first show all sessions without filtering
            if sessions.isEmpty {
                print("Large Widget: No sessions found")
                return []
            }
            
            // Filter for current selected meet if available, otherwise show all
            let selectedMeet = loadSelectedMeet()
            print("Large Widget: Selected meet is: \(selectedMeet ?? "none")")
            
            var filteredSessions = sessions
            
            if let selectedMeet = selectedMeet, !selectedMeet.isEmpty {
                filteredSessions = sessions.filter { $0.meet == selectedMeet }
                print("Large Widget: After filtering by meet '\(selectedMeet)': \(filteredSessions.count) sessions")
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
            
            print("Large Widget: After date filtering: \(upcomingSessions.count) sessions")
            
            let sortedSessions = upcomingSessions.sorted { session1, session2 in
                let date1 = dateFormatter.date(from: session1.date) ?? Date.distantFuture
                let date2 = dateFormatter.date(from: session2.date) ?? Date.distantFuture
                return date1 < date2
            }
            
            print("Large Widget: Returning \(sortedSessions.count) sessions")
            return Array(sortedSessions.prefix(15)) // Show up to 15 sessions for large widget
        }
        
        print("Large Widget: No UserDefaults data found for saved_sessions")
        return []
    }
}

struct LargeWidgetView: View {
    var entry: LargeWidgetTimelineProvider.Entry
    
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
                    
                    LazyVStack(alignment: .leading, spacing: 4) {
                        ForEach(Array(entry.savedSessions.prefix(6)), id: \.id) { session in
                            LargeSessionRowView(session: session)
                        }
                        
                        if entry.savedSessions.count > 6 {
                            Text("+ \(entry.savedSessions.count - 6) more")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                                .padding(.top, 4)
                        }
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

struct LargeSessionRowView: View {
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
                .frame(width: 6, height: 20)
            
            VStack(alignment: .leading, spacing: 1) {
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
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Color.secondary.opacity(0.1))
        .cornerRadius(6)
    }
}

// Preview removed - requires iOS 17.0+