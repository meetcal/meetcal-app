import WidgetKit
import SwiftUI

@main
struct MeetCalWidgetBundle: WidgetBundle {
    var body: some Widget {
        MeetCalMediumWidget()
        MeetCalLargeWidget()
    }
}