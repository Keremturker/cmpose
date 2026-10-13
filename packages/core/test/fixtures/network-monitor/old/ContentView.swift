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
    @Environment(\.colorScheme) var colorScheme

    var body: some View {
        ComposeView()
        .ignoresSafeArea()
        .task {
            requestNotificationPermission()
        }
        .task {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.01) {
                IosThemeObserver().updateTheme(isDark: colorScheme == .dark)
            }
        }
        .onChange(of: colorScheme) { newValue in
            DispatchQueue.main.async {
                IosThemeObserver().updateTheme(isDark: newValue == .dark)
            }
        }
    }
}

func requestNotificationPermission() {
    let center = UNUserNotificationCenter.current()

    center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in    }
}
