import UIKit

/// Analyzes UITouch event streams for machine-like patterns.
///
/// Detection signals:
/// - Touch-down to touch-up timing distributions (humans have natural jitter)
/// - Touch path curvature (humans draw natural arcs, machines draw perfect Bezier curves)
/// - Pressure / radius variation over touch duration
/// - Multi-touch accidental touch patterns
/// - Inter-touch interval clustering
final class TouchBiometricsAnalyzer {
    /// Recent touch sequences for analysis.
    private var sequences: [TouchSequence] = []
    /// Maximum sequences to retain.
    private let maxSequences: Int = 200
    /// Current active touches by touch ID.
    private var activeTouches: [String: TouchSequence] = [:]

    // MARK: - Event Ingestion

    /// Feed a raw UITouch event into the analyzer.
    func ingest(event: UIEvent, in view: UIView) {
        guard let touches = event.allTouches else { return }
        for touch in touches {
            let location = touch.preciseLocation(in: view)
            let prevLocation = touch.precisePreviousLocation(in: view)

            let evt = TouchEvent(
                id: "\(Unmanaged.passUnretained(touch).toOpaque())",
                timestamp: event.timestamp,
                phase: TouchEvent.Phase(uiPhase: touch.phase),
                location: location,
                previousLocation: prevLocation == location ? nil : prevLocation,
                force: touch.force,
                maximumPossibleForce: touch.maximumPossibleForce,
                majorRadius: touch.majorRadius,
                majorRadiusTolerance: touch.majorRadiusTolerance,
                altitudeAngle: touch.altitudeAngle,
                azimuthAngle: touch.azimuthAngle(in: view),
                estimationUpdateIndex: touch.estimationUpdateIndex?.intValue,
                type: TouchEvent.TouchType(uiType: touch.type)
            )

            let touchID = evt.id
            if evt.phase == .began {
                activeTouches[touchID] = TouchSequence(touchID: touchID, events: [evt])
            } else if var seq = activeTouches[touchID] {
                seq.events.append(evt)
                if evt.phase == .ended || evt.phase == .cancelled {
                    sequences.append(seq)
                    activeTouches.removeValue(forKey: touchID)
                    pruneSequences()
                } else {
                    activeTouches[touchID] = seq
                }
            }
        }
    }

    private func pruneSequences() {
        if sequences.count > maxSequences {
            sequences.removeFirst(sequences.count - maxSequences)
        }
    }

    // MARK: - Touch Biometrics Scoring

    /// Compute a touch biometrics score — 0.0 (human) … 1.0 (automated).
    func computeScore() -> (score: Double, flags: [DetectionResult.DetectionFlag]) {
        guard sequences.count >= 5 else {
            return (0.0, [])  // not enough data
        }

        var flags: [DetectionResult.DetectionFlag] = []
        var subScores: [Double] = []

        // 1. Curvature analysis
        let curlResult = analyzeCurvature()
        subScores.append(curlResult.score)
        if curlResult.flagged { flags.append(.perfectCurvature) }

        // 2. Timing consistency
        let timingResult = analyzeTiming()
        subScores.append(timingResult.score)
        if timingResult.flagged { flags.append(.unnaturalTiming) }

        // 3. Pressure / radius variation
        let pressureResult = analyzePressureVariation()
        subScores.append(pressureResult.score)
        if pressureResult.flagged { flags.append(.missingPressureVariation) }

        let radiusResult = analyzeRadiusVariation()
        subScores.append(radiusResult.score)
        if radiusResult.flagged { flags.append(.constantRadius) }

        // 4. Accidental touch detection
        let accidentalResult = analyzeAccidentalTouches()
        subScores.append(accidentalResult.score)
        if accidentalResult.flagged { flags.append(.noAccidentalTouches) }

        // 5. Inter-touch interval clustering
        let intervalResult = analyzeInterTouchIntervals()
        subScores.append(intervalResult.score)
        if intervalResult.flagged { flags.append(.unnaturalTiming) }  // reuses flag

        let avgScore = subScores.reduce(0, +) / Double(max(subScores.count, 1))
        return (min(avgScore, 1.0), flags)
    }

    // MARK: - Individual Analyzers

    /// Check if swipe curves are too-perfect Bezier curves.
    /// Machines produce curvature ratios tightly clustered around a narrow range;
    /// humans produce a wider spread.
    private func analyzeCurvature() -> (score: Double, flagged: Bool) {
        let curvatureRatios = sequences
            .filter { $0.pathLength > 20 && $0.straightLineDistance > 10 }
            .map(\.curvatureRatio)

        guard curvatureRatios.count >= 5 else { return (0, false) }

        let cv = coefficientOfVariation(curvatureRatios)
        // Human CV for curvature is typically 0.08–0.25.
        // Machine CV is extremely low (< 0.03) because every swipe follows
        // the same Bezier algorithm with the same variance parameter.
        if cv < 0.02 { return (0.9, true) }
        if cv < 0.04 { return (0.7, true) }
        if cv < 0.06 { return (0.4, false) }
        return (0.0, false)
    }

    /// Check if inter-event timing within touches is too consistent.
    private func analyzeTiming() -> (score: Double, flagged: Bool) {
        let allDeltas = sequences.flatMap(\.interEventDeltasMs)
        guard allDeltas.count >= 20 else { return (0, false) }

        let cv = coefficientOfVariation(allDeltas)
        // Human touch event cadence varies naturally (cv ~0.3–0.8).
        // Machine event injection produces nearly identical deltas (cv < 0.1).
        if cv < 0.05 { return (0.95, true) }
        if cv < 0.10 { return (0.7, true) }
        if cv < 0.15 { return (0.4, false) }
        return (0.0, false)
    }

    /// Check if pressure varies over touch duration.
    /// Human fingers naturally vary pressure; synthetic touches often use constant force.
    private func analyzePressureVariation() -> (score: Double, flagged: Bool) {
        let pressureCVs = sequences
            .filter { $0.events.count >= 3 }
            .map { seq -> Double in
                let forces = seq.forceSamples
                return coefficientOfVariation(forces)
            }

        guard pressureCVs.count >= 5 else { return (0, false) }

        let avgCV = pressureCVs.reduce(0, +) / Double(pressureCVs.count)
        // Human pressure CV is typically 0.05–0.30.
        // Machine pressure CV is near zero (constant force).
        if avgCV < 0.01 { return (0.9, true) }
        if avgCV < 0.03 { return (0.6, true) }
        if avgCV < 0.05 { return (0.3, false) }
        return (0.0, false)
    }

    /// Check if majorRadius varies over touch duration.
    /// Real fingers change contact area; synthetic touches use constant radius.
    private func analyzeRadiusVariation() -> (score: Double, flagged: Bool) {
        let radiusCVs = sequences
            .filter { $0.events.count >= 3 }
            .map { seq -> Double in
                coefficientOfVariation(seq.radiusSamples)
            }

        guard radiusCVs.count >= 5 else { return (0, false) }

        let avgCV = radiusCVs.reduce(0, +) / Double(radiusCVs.count)
        if avgCV < 0.01 { return (0.85, true) }
        if avgCV < 0.03 { return (0.55, true) }
        if avgCV < 0.05 { return (0.25, false) }
        return (0.0, false)
    }

    /// Check for accidental/palm/edge touches.
    /// Humans occasionally trigger brief, tiny-radius touches from palm/edge contact.
    /// Machines never produce these — their touch sequences are "clean."
    private func analyzeAccidentalTouches() -> (score: Double, flagged: Bool) {
        let total = sequences.count
        guard total >= 20 else { return (0, false) }

        // Accidental touch: duration < 80ms AND radius > 20pt (palm) OR
        // duration < 30ms (edge graze)
        let accidentalCount = sequences.filter { seq in
            let avgRadius = seq.radiusSamples.reduce(0, +) / CGFloat(max(seq.radiusSamples.count, 1))
            return (seq.duration < 0.08 && avgRadius > 20) || seq.duration < 0.03
        }.count

        let accidentalRate = Double(accidentalCount) / Double(total)
        // Humans have 2–8% accidental touches.
        // Machines have 0% accidental touches.
        if accidentalRate == 0 { return (0.7, true) }
        if accidentalRate < 0.005 { return (0.5, true) }
        if accidentalRate < 0.01 { return (0.25, false) }
        return (0.0, false)
    }

    /// Cluster inter-touch intervals (time between end of one touch and start of next).
    /// Machines produce highly consistent intervals (from fixed actionDelay config).
    /// Humans produce scattered intervals.
    private func analyzeInterTouchIntervals() -> (score: Double, flagged: Bool) {
        let sorted = sequences.sorted { $0.startTime < $1.startTime }
        guard sorted.count >= 5 else { return (0, false) }

        var intervals: [Double] = []
        for i in 1..<sorted.count {
            let gap = sorted[i].startTime - sorted[i - 1].endTime
            if gap > 0 && gap < 5.0 {  // ignore very long gaps (user idle)
                intervals.append(gap)
            }
        }

        guard intervals.count >= 5 else { return (0, false) }

        let cv = coefficientOfVariation(intervals)
        // Human inter-touch CV is typically 0.4–1.2 (highly variable).
        // Machine inter-touch CV from HumanizeConfig.action_delay_ms is very low.
        if cv < 0.1 { return (0.9, true) }
        if cv < 0.2 { return (0.6, true) }
        if cv < 0.3 { return (0.3, false) }
        return (0.0, false)
    }

    // MARK: - Helpers

    /// Coefficient of variation = stdDev / mean.
    /// Zero-mean guard returns 0.
    private func coefficientOfVariation(_ values: [CGFloat]) -> Double {
        let doubles = values.map(Double.init)
        return coefficientOfVariation(doubles)
    }

    private func coefficientOfVariation(_ values: [Double]) -> Double {
        guard values.count > 1 else { return 0 }
        let mean = values.reduce(0, +) / Double(values.count)
        guard mean != 0 else { return 0 }
        let variance = values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(values.count - 1)
        return sqrt(variance) / abs(mean)
    }

    /// Reset all state (e.g., on session restart).
    func reset() {
        sequences.removeAll()
        activeTouches.removeAll()
    }
}

// MARK: - Phase mapping

extension TouchEvent.Phase {
    init(uiPhase: UITouch.Phase) {
        switch uiPhase {
        case .began: self = .began
        case .moved: self = .moved
        case .stationary: self = .stationary
        case .ended: self = .ended
        case .cancelled: self = .cancelled
        @unknown default: self = .unknown
        }
    }
}

extension TouchEvent.TouchType {
    init(uiType: UITouch.TouchType) {
        switch uiType {
        case .direct: self = .direct
        case .indirect: self = .indirect
        case .indirectPointer: self = .indirect
        case .pencil: self = .pencil
        @unknown default: self = .unknown
        }
    }
}
