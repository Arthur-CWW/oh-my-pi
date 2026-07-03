import SwiftUI
import Combine

/// Root view that orchestrates all detection layers and the video feed.
///
/// Responsibilities:
/// - Owns all analyzer instances (TouchBiometrics, Behavioral, Environment)
/// - Wires touch events from TouchTrackingView into the analyzers
/// - Periodically computes detection scores via DetectionScorer
/// - Drives the DebugOverlay with score updates
/// - Logs all events through DetectionLogger
struct ContentView: View {
    @StateObject private var engine = DetectionEngine()

    var body: some View {
        ZStack {
            TouchTrackingView(
                analyzer: engine.touchAnalyzer,
                logger: engine.logger,
                sessionID: engine.sessionID,
                content: VideoFeedView(
                    videos: VideoItem.samples,
                    behavioralAnalyzer: engine.behavioralAnalyzer,
                    logger: engine.logger,
                    sessionID: engine.sessionID
                )
            )
            .ignoresSafeArea()

            // Floating debug pill — tap to open full debug sheet
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    DebugPill(snapshot: engine.latestSnapshot)
                        .onTapGesture {
                            engine.showDebugSheet = true
                        }
                }
                .padding(.trailing, 12)
                .padding(.bottom, 100)
            }
        }
        .sheet(isPresented: $engine.showDebugSheet) {
            DebugOverlayView(engine: engine)
        }
        .onAppear {
            engine.startSession()
        }
    }
}

// MARK: - Detection Engine (ViewModel)

@MainActor
final class DetectionEngine: ObservableObject {
    let sessionID = UUID().uuidString
    let touchAnalyzer = TouchBiometricsAnalyzer()
    let behavioralAnalyzer = BehavioralAnalyzer()
    let environmentDetector = EnvironmentDetector()
    let scorer = DetectionScorer()
    let logger = DetectionLogger()

    @Published var latestSnapshot = ScoreSnapshot(
        touch: 0, behavioral: 0, environmental: 0,
        composite: 0, riskLevel: .low, flags: [], timestamp: Date()
    )
    @Published var showDebugSheet = false

    private var scoreTimer: AnyCancellable?
    private var envCheckTimer: AnyCancellable?

    func startSession() {
        logger.log(
            eventType: .sessionStart,
            payload: ["sessionID": sessionID],
            sessionID: sessionID
        )

        // Run initial environmental check (sync portion)
        let envResult = environmentDetector.runSyncChecks()
        logger.log(
            eventType: .envCheck,
            payload: [
                "score": String(format: "%.3f", envResult.score),
                "flags": envResult.flags.map(\.rawValue).joined(separator: ","),
            ],
            sessionID: sessionID
        )

        // Compute initial score
        computeAndPublish(envScore: envResult.score, envFlags: envResult.flags)

        // Periodic re-scoring every 2 seconds
        scoreTimer = Timer.publish(every: 2.0, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.periodicScoreUpdate()
            }

        // Periodic async environmental checks every 30 seconds
        envCheckTimer = Timer.publish(every: 30.0, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.runAsyncEnvironmentCheck()
            }
    }

    func periodicScoreUpdate() {
        let touchResult = touchAnalyzer.computeScore()
        let behavioralResult = behavioralAnalyzer.computeScore()

        // Environmental: use last known (async checks update this)
        let envResult = environmentDetector.runSyncChecks()

        let result = scorer.compute(
            touchBiometrics: touchResult,
            behavioral: behavioralResult,
            environmental: envResult,
            sessionID: sessionID
        )

        let snapshot = ScoreSnapshot(
            touch: result.touchBiometricsScore,
            behavioral: result.behavioralScore,
            environmental: result.environmentalScore,
            composite: result.compositeScore,
            riskLevel: result.riskLevel,
            flags: result.flags,
            timestamp: result.timestamp
        )

        latestSnapshot = snapshot
        logger.logScore(snapshot, sessionID: sessionID)
    }

    private func runAsyncEnvironmentCheck() {
        environmentDetector.runAllChecks { [weak self] score, flags in
            guard let self = self else { return }
            self.logger.log(
                eventType: .envCheck,
                payload: [
                    "score": String(format: "%.3f", score),
                    "flags": flags.map(\.rawValue).joined(separator: ","),
                    "type": "async_full",
                ],
                sessionID: self.sessionID
            )
            // Trigger a re-score with updated environmental data.
            self.periodicScoreUpdate()
        }
    }

    private func computeAndPublish(envScore: Double, envFlags: [DetectionResult.DetectionFlag]) {
        let touchResult = touchAnalyzer.computeScore()
        let behavioralResult = behavioralAnalyzer.computeScore()

        let result = scorer.compute(
            touchBiometrics: touchResult,
            behavioral: behavioralResult,
            environmental: (envScore, envFlags),
            sessionID: sessionID
        )

        latestSnapshot = ScoreSnapshot(
            touch: result.touchBiometricsScore,
            behavioral: result.behavioralScore,
            environmental: result.environmentalScore,
            composite: result.compositeScore,
            riskLevel: result.riskLevel,
            flags: result.flags,
            timestamp: result.timestamp
        )
        logger.logScore(latestSnapshot, sessionID: sessionID)
    }

    /// Force an immediate rescore — called from DebugOverlayView's Refresh button.
    func triggerRescore() {
        periodicScoreUpdate()
    }

    func stopSession() {
        scoreTimer?.cancel()
        envCheckTimer?.cancel()
        touchAnalyzer.reset()
        behavioralAnalyzer.reset()
        environmentDetector.reset()
        logger.log(
            eventType: .sessionEnd,
            payload: ["sessionID": sessionID],
            sessionID: sessionID
        )
    }
}

// MARK: - Debug Pill

/// A compact floating pill showing the current composite score and risk level.
struct DebugPill: View {
    let snapshot: ScoreSnapshot

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(pillColor)
                .frame(width: 6, height: 6)
            Text(String(format: "%.0f%%", snapshot.composite * 100))
                .font(.caption.monospaced())
                .foregroundColor(.white)
            Text(snapshot.riskLevel.rawValue)
                .font(.caption2)
                .foregroundColor(.white.opacity(0.7))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.ultraThinMaterial)
        .clipShape(Capsule())
        .shadow(radius: 4)
    }

    private var pillColor: Color {
        switch snapshot.riskLevel {
        case .low: return .green
        case .elevated: return .yellow
        case .suspicious: return .orange
        case .automated: return .red
        }
    }
}
