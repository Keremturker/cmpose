import UIKit
import SwiftUI
import Shared
import UserNotifications

struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        MainViewControllerKt.MainViewController()
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}

struct ContentView: View {
    var body: some View {
        ComposeView()
        .ignoresSafeArea()
        .task {
            requestNotificationPermission()
        }
    }
}

func requestNotificationPermission() {
    // Only the network monitor posts notifications, and it runs in debug builds only.
    #if DEBUG
    let center = UNUserNotificationCenter.current()

    center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in    }
    #endif
}
