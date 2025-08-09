import ExpoModulesCore
import WidgetKit

public class ExpoWidgetsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MeetCalWidgets")
    
    // Function to update widget data from the app
    AsyncFunction("updateWidgetData") { (data: [String: Any]) in
      if let userDefaults = UserDefaults(suiteName: "group.com.memohnsen.meetcal.expowidgets") {
        
        // Update selected meet
        if let selectedMeet = data["selectedMeet"] as? String {
          userDefaults.set(selectedMeet, forKey: "selected_meet")
        }
        
        // Update available meets
        if let availableMeets = data["availableMeets"] as? [[String: Any]] {
          if let jsonData = try? JSONSerialization.data(withJSONObject: availableMeets) {
            userDefaults.set(jsonData, forKey: "available_meets")
          }
        }
        
        // Update saved sessions
        if let savedSessions = data["savedSessions"] as? [[String: Any]] {
          if let jsonData = try? JSONSerialization.data(withJSONObject: savedSessions) {
            userDefaults.set(jsonData, forKey: "saved_sessions")
          }
        }
        
        userDefaults.synchronize()
        
        // Reload all widgets
        if #available(iOS 14.0, *) {
          WidgetCenter.shared.reloadAllTimelines()
        }
      }
    }
    
    // Function to handle widget URL parsing
    Function("parseWidgetUrl") { (url: String) -> [String: String] in
      guard let urlComponents = URLComponents(string: url) else {
        return ["action": "unknown"]
      }
      
      switch urlComponents.host {
      case "select-meet":
        return [
          "action": "select-meet", 
          "meetId": urlComponents.queryItems?.first(where: { $0.name == "meetId" })?.value ?? ""
        ]
      case "saved-sessions":
        return [
          "action": "saved-sessions",
          "meetId": urlComponents.queryItems?.first(where: { $0.name == "meetId" })?.value ?? ""
        ]
      default:
        return ["action": "unknown"]
      }
    }
  }
}