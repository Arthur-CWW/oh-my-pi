import SwiftUI

/// Blue-team honeypot: detects automated/non-human usage of the app.
///
/// Layers:
/// 1. Touch biometrics — UITouch event stream analysis
/// 2. Behavioral analysis — interaction pattern detection
/// 3. Environmental detection — VM/jailbreak/automation detection
/// 4. ML scoring — composite confidence score
/// 5. UI — TikTok-style video feed with debug panel
///
/// Adversary: vphone-cli with EXP variant (virtual iPhone, iOS 26 VM on macOS).
///
/// Deployment:
/// 1. Open in Xcode 16+
/// 2. Set deployment target to iOS 18+
/// 3. Select device or simulator
/// 4. Build and Run (⌘R)
///
/// For vphone-cli VM testing:
/// 1. Build .app for iOS device
/// 2. Install via `xcrun devicectl device install app --device <UDID> DetectionApp.app`
/// 3. Or use `ios deploy` / `go-ios` via USB forwarding
///
/// No external dependencies — uses only iOS-shipped frameworks:
/// UIKit, SwiftUI, CoreMotion, IOKit, Darwin (sysctl, dyld).
@main
struct DetectionApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
                .statusBarHidden()
        }
    }
}
