import SwiftUI
import Shared

@main
struct iOSApp: App {
    init() {
        // Once per process; ContentView (and its view controller) is created per window.
        MainViewControllerKt.startKoinAtLaunch()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
