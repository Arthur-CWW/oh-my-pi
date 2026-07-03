import Foundation
import UIKit

/// Detects non-human interaction patterns in scrolls, dwell times,
/// interaction sequences, and text entry timing.
///
/// Humans are chaotic — machines follow scripted paths with rigid timing.
final class BehavioralAnalyzer {
    /// Logged interactions with timestamps.
    private var interactions: [LoggedInteraction] = []
    /// Scroll event velocity samples.
    private var scrollSamples: [ScrollSample] = []
    /// View dwell time records (keyed by view description).
    private var dwellTimes: [String: [TimeInterval]] = [:]
    /// Keystroke interval records.
    private var keystrokeIntervals: [Double] = []
    /// Last keystroke timestamp for interval calculation.
    private var lastKeystrokeTime: Date?

    private let maxInteractions = 500
    private let maxScrollSamples = 200
    private let maxKeystrokeIntervals = 100

    // MARK: - Data models

    struct LoggedInteraction {
        let type: InteractionType
        let timestamp: Date
        let viewID: String  // describes which view was interacted with
    }

    struct ScrollSample {
        let timestamp: Date
        let velocity: CGPoint   // points per second
        let contentOffset: CGPoint
    }

    // MARK: - Ingestion

    func logInteraction(type: InteractionType, viewID: String) {
        let interaction = LoggedInteraction(type: type, timestamp: Date(), viewID: viewID)
        interactions.append(interaction)
        if interactions.count > maxInteractions {
            interactions.removeFirst(interactions.count - maxInteractions)
        }

        // Track view dwell: time spent on this view before interaction
        // We'll compute dwell on scoring, not here.
    }

    func logScroll(velocity: CGPoint, contentOffset: CGPoint) {
        let sample = ScrollSample(timestamp: Date(), velocity: velocity, contentOffset: contentOffset)
        scrollSamples.append(sample)
        if scrollSamples.count > maxScrollSamples {
            scrollSamples.removeFirst(scrollSamples.count - maxScrollSamples)
        }
    }

    func logKeystroke() {
        let now = Date()
        if let last = lastKeystrokeTime {
            let interval = now.timeIntervalSince(last)
            keystrokeIntervals.append(interval)
            if keystrokeIntervals.count > maxKeystrokeIntervals {
                keystrokeIntervals.removeFirst()
            }
        }
        lastKeystrokeTime = now
    }

    // MARK: - Scoring

    func computeScore() -> (score: Double, flags: [DetectionResult.DetectionFlag]) {
        var flags: [DetectionResult.DetectionFlag] = []
        var subScores: [Double] = []

        // 1. Scroll velocity profile
        let scrollResult = analyzeScrollVelocity()
        subScores.append(scrollResult.score)
        if scrollResult.flagged { flags.append(.constantScrollVelocity) }

        // 2. View dwell time distribution
        let dwellResult = analyzeDwellTimes()
        subScores.append(dwellResult.score)
        if dwellResult.flagged { flags.append(.fixedDwellTimes) }

        // 3. Interaction sequence entropy
        let entropyResult = analyzeInteractionEntropy()
        subScores.append(entropyResult.score)
        if entropyResult.flagged { flags.append(.lowInteractionEntropy) }

        // 4. Keystroke timing
        let keystrokeResult = analyzeKeystrokeTiming()
        subScores.append(keystrokeResult.score)
        if keystrokeResult.flagged { flags.append(.machineKeystrokeTiming) }

        let nonZeroScores = subScores.filter { $0 > 0 }
        guard !nonZeroScores.isEmpty else { return (0.0, flags) }
        let avgScore = nonZeroScores.reduce(0, +) / Double(nonZeroScores.count)
        return (min(avgScore, 1.0), flags)
    }

    // MARK: - Individual Analyzers

    /// Scroll velocity profiles: humans decelerate naturally; machines scroll at constant speed.
    private func analyzeScrollVelocity() -> (score: Double, flagged: Bool) {
        guard scrollSamples.count >= 10 else { return (0, false) }

        // Extract speed magnitudes
        let speeds = scrollSamples.map { sample -> Double in
            sqrt(Double(sample.velocity.x * sample.velocity.x + sample.velocity.y * sample.velocity.y))
        }

        // Check for constant velocity: coefficient of variation
        let cv = coefficientOfVariation(speeds)
        // Human scrolling: CV ~0.3–0.8 (variable speed + deceleration)
        // Machine scrolling: CV < 0.15 (constant or near-constant speed)
        if cv < 0.05 { return (0.9, true) }
        if cv < 0.10 { return (0.7, true) }
        if cv < 0.15 { return (0.4, false) }

        // Check for deceleration pattern: is there a downward trend?
        let hasDeceleration = detectDeceleration(speeds)
        if !hasDeceleration { return (0.5, true) }

        return (0.0, false)
    }

    /// Check if speeds decrease over time (natural deceleration).
    private func detectDeceleration(_ speeds: [Double]) -> Bool {
        guard speeds.count >= 6 else { return true } // insufficient data, give benefit of doubt
        let firstHalf = speeds.prefix(speeds.count / 2)
        let secondHalf = speeds.suffix(speeds.count / 2)
        let firstAvg = firstHalf.reduce(0, +) / Double(firstHalf.count)
        let secondAvg = secondHalf.reduce(0, +) / Double(secondHalf.count)
        // Expect second half to be slower (deceleration).
        return secondAvg < firstAvg * 0.85
    }

    /// View dwell times: humans read at variable speeds; machines have fixed timing.
    private func analyzeDwellTimes() -> (score: Double, flagged: Bool) {
        // Compute dwell times per view from interaction timestamps.
        var allDwells: [TimeInterval] = []
        var viewTransitions: [(String, Date)] = []

        for interaction in interactions {
            if let last = viewTransitions.last {
                if last.0 != interaction.viewID {
                    let dwell = interaction.timestamp.timeIntervalSince(last.1)
                    if dwell < 60 {  // ignore very long dwells (user walked away)
                        allDwells.append(dwell)
                        var existing = dwellTimes[last.0] ?? []
                        existing.append(dwell)
                        dwellTimes[last.0] = existing
                    }
                }
            }
            viewTransitions.append((interaction.viewID, interaction.timestamp))
        }

        guard allDwells.count >= 5 else { return (0, false) }

        let cv = coefficientOfVariation(allDwells)
        // Human dwell CV: 0.3–0.9 (widely variable reading speed)
        // Machine dwell CV: < 0.15 (fixed timing from actionDelay config)
        if cv < 0.08 { return (0.85, true) }
        if cv < 0.15 { return (0.55, true) }
        if cv < 0.25 { return (0.3, false) }
        return (0.0, false)
    }

    /// Interaction sequence entropy: humans are chaotic; machines follow scripted paths.
    private func analyzeInteractionEntropy() -> (score: Double, flagged: Bool) {
        guard interactions.count >= 10 else { return (0, false) }

        // Build a transition matrix: for each interaction type, what follows?
        var transitions: [String: [String: Int]] = [:]
        for i in 1..<interactions.count {
            let prev = interactions[i - 1].type.rawValue
            let curr = interactions[i].type.rawValue
            transitions[prev, default: [:]][curr, default: 0] += 1
        }

        // Compute entropy of the transition distribution.
        var entropy = 0.0
        for (_, nexts) in transitions {
            let total = Double(nexts.values.reduce(0, +))
            for count in nexts.values {
                let p = Double(count) / total
                if p > 0 { entropy -= p * log2(p) }
            }
        }

        // Normalize by number of transition sources.
        let normalizedEntropy = transitions.isEmpty ? 0 : entropy / Double(transitions.count)
        // Human entropy: > 1.5 (chaotic transitions)
        // Machine entropy: < 0.8 (scripted: always swipe→swipe→tap→swipe…)
        if normalizedEntropy < 0.3 { return (0.9, true) }
        if normalizedEntropy < 0.6 { return (0.65, true) }
        if normalizedEntropy < 0.9 { return (0.35, false) }
        return (0.0, false)
    }

    /// Keystroke timing: humans have variable inter-keystroke intervals.
    private func analyzeKeystrokeTiming() -> (score: Double, flagged: Bool) {
        guard keystrokeIntervals.count >= 8 else { return (0, false) }

        let cv = coefficientOfVariation(keystrokeIntervals)
        // Human keystroke CV: 0.25–1.0 (variable typing speed)
        // Machine keystroke CV: < 0.12 (from HumanizeConfig.typing_wpm range)
        if cv < 0.06 { return (0.9, true) }
        if cv < 0.12 { return (0.6, true) }
        if cv < 0.20 { return (0.3, false) }
        return (0.0, false)
    }

    // MARK: - Helpers

    private func coefficientOfVariation(_ values: [Double]) -> Double {
        guard values.count > 1 else { return 0 }
        let mean = values.reduce(0, +) / Double(values.count)
        guard mean != 0 else { return 0 }
        let variance = values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(values.count - 1)
        return sqrt(variance) / abs(mean)
    }


    func reset() {
        interactions.removeAll()
        scrollSamples.removeAll()
        dwellTimes.removeAll()
        keystrokeIntervals.removeAll()
        lastKeystrokeTime = nil
    }
}
