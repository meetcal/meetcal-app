import WidgetKit
import SwiftUI

@main
struct MeetCalWidgetBundle: WidgetBundle {
    var body: some Widget {
        MeetCalSmallWidget()
        MeetCalMediumWidget()
    }
}