import SwiftUI

/// Debug panel displaying real-time detection scores.
///
/// Subscribes to DetectionEngine.latestSnapshot via @ObservedObject
/// so scores auto-update as the 2-second periodic rescoring fires.
struct DebugOverlayView: View {
    @ObservedObject var engine: DetectionEngine

    var body: some View {
        let snapshot = engine.latestSnapshot
        NavigationStack {
            List {
                riskSection(snapshot)
                layerScoresSection(snapshot)
                flagsSection(snapshot)
                logSection
            }
            .navigationTitle("Detection Debug")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Refresh") {
                        engine.triggerRescore()
                    }
                }
            }
        }
    }

    // MARK: - Risk Level

    private func riskSection(_ snapshot: ScoreSnapshot) -> some View {
        Section {
            HStack {
                Text("Risk Level")
                    .font(.headline)
                Spacer()
                HStack(spacing: 6) {
                    Circle()
                        .fill(riskColor(snapshot.riskLevel))
                        .frame(width: 10, height: 10)
                    Text(snapshot.riskLevel.rawValue.uppercased())
                        .font(.headline)
                        .foregroundColor(riskColor(snapshot.riskLevel))
                }
            }
            HStack {
                Text("Composite Score")
                Spacer()
                Text(String(format: "%.3f", snapshot.composite))
                    .font(.system(.body, design: .monospaced))
                    .foregroundColor(snapshot.composite >= 0.7 ? .red : snapshot.composite >= 0.4 ? .orange : .green)
            }
            HStack {
                Text("Last Update")
                Spacer()
                Text(snapshot.timestamp, style: .time)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        } header: {
            Text("Summary")
        }
    }

    // MARK: - Layer Scores

    private func layerScoresSection(_ snapshot: ScoreSnapshot) -> some View {
        Section {
            ScoreRow(label: "Touch Biometrics", score: snapshot.touch, weight: 0.35)
            ScoreRow(label: "Behavioral Analysis", score: snapshot.behavioral, weight: 0.25)
            ScoreRow(label: "Environmental Detection", score: snapshot.environmental, weight: 0.40)
        } header: {
            Text("Layer Scores")
        } footer: {
            Text("Scores: 0.0 = human, 1.0 = automated. Weights for composite calculation.")
        }
    }

    // MARK: - Flags

    private func flagsSection(_ snapshot: ScoreSnapshot) -> some View {
        Section {
            if snapshot.flags.isEmpty {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                    Text("No flags raised")
                        .foregroundColor(.secondary)
                }
            } else {
                ForEach(snapshot.flags, id: \.rawValue) { flag in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "flag.fill")
                            .foregroundColor(flagColor(flag))
                            .font(.caption)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(flag.rawValue)
                                .font(.caption)
                                .fontWeight(.medium)
                            Text(flagDescription(flag))
                                .font(.caption2)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
        } header: {
            Text("Active Flags (\(snapshot.flags.count))")
        }
    }

    // MARK: - Log Info

    private var logSection: some View {
        Section {
            HStack {
                Text("Log File")
                Spacer()
                Text(logPath.lastPathComponent)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            HStack {
                Text("Session ID")
                Spacer()
                Text(String(engine.sessionID.prefix(8)) + "...")
                    .font(.caption.monospaced())
                    .foregroundColor(.secondary)
            }
        } header: {
            Text("Logging")
        }
    }

    // MARK: - Helpers

    private let logPath: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("DetectionLogs")
    }()

    private func riskColor(_ level: DetectionResult.RiskLevel) -> Color {
        switch level {
        case .low: return .green
        case .elevated: return .yellow
        case .suspicious: return .orange
        case .automated: return .red
        }
    }

    private func flagColor(_ flag: DetectionResult.DetectionFlag) -> Color {
        switch flag {
        case .virtualizationDetected, .jailbreakDetected,
             .staticSensorData, .automationProcessDetected:
            return .red
        case .perfectCurvature, .unnaturalTiming, .missingPressureVariation,
             .constantScrollVelocity, .machineKeystrokeTiming, .zeroNetworkLatency:
            return .orange
        default:
            return .yellow
        }
    }

    private func flagDescription(_ flag: DetectionResult.DetectionFlag) -> String {
        switch flag {
        case .perfectCurvature:
            return "Touch paths follow too-perfect Bezier curves — machine-like precision"
        case .unnaturalTiming:
            return "Inter-touch intervals are too consistent — lacks human jitter"
        case .missingPressureVariation:
            return "Touch pressure never varies — human fingers naturally modulate pressure"
        case .constantRadius:
            return "Contact radius never changes — real fingers flatten and deform"
        case .noAccidentalTouches:
            return "Zero accidental/palm touches in session — humans are messy"
        case .constantScrollVelocity:
            return "Scroll speed is constant — humans decelerate naturally"
        case .fixedDwellTimes:
            return "View dwell times are unnaturally uniform — humans read at variable speeds"
        case .lowInteractionEntropy:
            return "Interaction sequence follows a rigid script — humans are chaotic"
        case .machineKeystrokeTiming:
            return "Keystroke intervals lack human variance — bot-like typing"
        case .virtualizationDetected:
            return "VM artifacts found in sysctl, file paths, or disk timing"
        case .jailbreakDetected:
            return "Jailbreak indicators found: files, dyld injection, sandbox bypass"
        case .zeroNetworkLatency:
            return "Network latency is near-zero — suggests local VNC/RPC"
        case .staticSensorData:
            return "Accelerometer/gyroscope data is static — no physical device"
        case .automationProcessDetected:
            return "Known automation tool (WDA, XCTest, Frida) detected"
        }
    }
}

// MARK: - Score Row

struct ScoreRow: View {
    let label: String
    let score: Double
    let weight: Double

    var body: some View {
        HStack {
            Text(label)
                .font(.subheadline)
            Text("(×\(String(format: "%.0f", weight * 100))%)")
                .font(.caption2)
                .foregroundColor(.secondary)
            Spacer()
            Text(String(format: "%.3f", score))
                .font(.system(.body, design: .monospaced))
                .foregroundColor(scoreColor)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color.secondary.opacity(0.2))
                        .frame(height: 4)
                    RoundedRectangle(cornerRadius: 2)
                        .fill(scoreColor)
                        .frame(width: geo.size.width * score, height: 4)
                }
            }
            .frame(width: 40, height: 4)
        }
    }

    private var scoreColor: Color {
        if score >= 0.7 { return .red }
        if score >= 0.4 { return .orange }
        return .green
    }
}

// MARK: - Preview

#Preview {
    // Preview needs a mock engine — skip for now.
    Text("DebugOverlayView preview requires DetectionEngine")
}
