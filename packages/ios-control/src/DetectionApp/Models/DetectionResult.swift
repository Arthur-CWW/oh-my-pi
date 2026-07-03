import Foundation

/// Aggregated detection result with per-layer scores and overall confidence.
struct DetectionResult: Codable {
    var touchBiometricsScore: Double       // 0.0 (human) ... 1.0 (automated)
    var behavioralScore: Double
    var environmentalScore: Double
    var compositeScore: Double             // weighted combination
    var flags: [DetectionFlag]
    var timestamp: Date
    var sessionID: String

    enum DetectionFlag: String, Codable {
        // Touch biometric flags
        case perfectCurvature             // swipe path is too-perfect Bezier
        case unnaturalTiming              // inter-touch intervals too consistent
        case missingPressureVariation     // force never varies
        case constantRadius               // majorRadius never changes
        case noAccidentalTouches           // no palm/edge touches over long session

        // Behavioral flags
        case constantScrollVelocity       // scroll at fixed speed, no deceleration
        case fixedDwellTimes              // view dwell times are unnaturally uniform
        case lowInteractionEntropy        // interaction sequence is too predictable
        case machineKeystrokeTiming       // keystroke intervals lack human variance

        // Environmental flags
        case virtualizationDetected       // VM artifacts found
        case jailbreakDetected            // jailbreak indicators present
        case zeroNetworkLatency           // localhost-grade RTT to "internet" services
        case staticSensorData             // accelerometer/gyro never change
        case automationProcessDetected    // known automation tool process running
    }

    var isAutomated: Bool {
        compositeScore >= 0.7
    }

    var riskLevel: RiskLevel {
        switch compositeScore {
        case 0..<0.3: return .low
        case 0.3..<0.5: return .elevated
        case 0.5..<0.7: return .suspicious
        default: return .automated
        }
    }

    enum RiskLevel: String, Codable {
        case low, elevated, suspicious, automated
    }
}

/// Lightweight snapshot sent to the debug overlay.
struct ScoreSnapshot {
    let touch: Double
    let behavioral: Double
    let environmental: Double
    let composite: Double
    let riskLevel: DetectionResult.RiskLevel
    let flags: [DetectionResult.DetectionFlag]
    let timestamp: Date
}
