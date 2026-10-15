// cmpose:backend
import FirebaseCore
// /cmpose:backend
// cmpose:backend
import GoogleSignIn
// /cmpose:backend
import SwiftUI
import Shared

@main
struct iOSApp: App {
    init() {
        // Once per process; ContentView (and its view controller) is created per window.
        MainViewControllerKt.startKoinAtLaunch()
        // cmpose:backend
        // Firebase app config (sign-in): GoogleService-Info.plist is per developer and git-ignored, and the
        // build copies it into the app only when it exists. Without it Firebase is not configured and
        // sign-in reports Unavailable; configure() would stop the app on a missing file. Koin resolves the
        // sign-in bridge lazily, so registering it right after Koin starts is early enough.
        let firebaseConfigured = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil
        if firebaseConfigured { FirebaseApp.configure() }
        SignInRegistrationKt.registerSignInBridge(signIn: SignInBridge(firebaseConfigured: firebaseConfigured))
        // /cmpose:backend
        // Google Mobile Ads lives in Swift (AdsBridge.swift); Kotlin reaches it through this bridge.
        AdsBridgeRegistrationKt.registerAdsBridge(bridge: AdsBridge())
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                // Deep links (multiplatform://…, Universal Links once set up): Kotlin opens the screen
                // cmpose:backend
                // Google Sign-In's return comes first; anything else is a deep link
                // /cmpose:backend
                // cmpose:backend-off: .onOpenURL { url in _ = DeepLinksKt.handleDeepLink(uri: url.absoluteString) }
                .onOpenURL { url in if !GIDSignIn.sharedInstance.handle(url) { _ = DeepLinksKt.handleDeepLink(uri: url.absoluteString) } }
        }
    }
}
