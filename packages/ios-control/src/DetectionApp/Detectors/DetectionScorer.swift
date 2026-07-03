import Foundation

/// Combines signals from all detection layers into a composite confidence score.
///
/// Uses weighted anomaly scoring rather than full ML (Isolation Forest)
/// to keep the implementation self-contained without external dependencies.
/// The weights encode domain knowledge about which signals are most reliable.
///
/// Scoring strategy:
/// - Each layer produces a 0.0–1.0 score.
/// - Environmental signals carry highest weight (VM/jailbreak are definitive).
/// - Touch biometrics carry high weight (hard to fake at the event level).
/// - Behavioral signals carry medium weight (can be improved by adversary).
/// - Scores are combined via weighted geometric mean to penalize consensus.
/// - Flags are accumulated and included in the result.
final class DetectionScorer {

    // MARK: - Layer Weights

    /// Environmental detection: 40% — hardest to fake.
    private let envWeight = 0.40
    /// Touch biometrics: 35% — second hardest, requires kernel-level injection.
    private let touchWeight = 0.35
    /// Behavioral analysis: 25% — can be adapted by adversary.
    private let behavioralWeight = 0.25

    // MARK: - Thresholds

    /// Composite score at or above this triggers automated classification.
    var automationThreshold: Double = 0.7

    /// Per-layer score that independently triggers heightened scrutiny.
    var perLayerAlertThreshold: Double = 0.6

    // MARK: - Scoring

    /// Combine per-layer scores into a composite result.
    func compute(
        touchBiometrics: (score: Double, flags: [DetectionResult.DetectionFlag]),
        behavioral: (score: Double, flags: [DetectionResult.DetectionFlag]),
        environmental: (score: Double, flags: [DetectionResult.DetectionFlag]),
        sessionID: String
    ) -> DetectionResult {
        let allFlags = touchBiometrics.flags + behavioral.flags + environmental.flags

        // Weighted geometric mean — if any layer is near-zero, composite stays low.
        // This penalizes "consensus" — adversary must beat ALL layers.
        let layers: [(score: Double, weight: Double)] = [
            (touchBiometrics.score, touchWeight),
            (behavioral.score, behavioralWeight),
            (environmental.score, envWeight),
        ]

        let composite = weightedGeometricMean(layers)

        // Apply a synergy bonus: if multiple layers independently flag,
        // the composite score should be higher.
        let flagBonus = computeSynergyBonus(layers, allFlags)

        let adjustedComposite = min(composite + flagBonus, 1.0)

        return DetectionResult(
            touchBiometricsScore: touchBiometrics.score,
            behavioralScore: behavioral.score,
            environmentalScore: environmental.score,
            compositeScore: adjustedComposite,
            flags: allFlags,
            timestamp: Date(),
            sessionID: sessionID
        )
    }

    /// Weighted geometric mean: exp(Σ w_i * ln(x_i + ε)) → 0.0–1.0.
    ///
    /// Geometric mean is more punitive than arithmetic — if any layer is
    /// 0, the composite approaches 0. This prevents a single high-scoring
    /// layer from dominating.
    private func weightedGeometricMean(_ layers: [(score: Double, weight: Double)]) -> Double {
        let epsilon = 0.0001  // prevent ln(0)
        let totalWeight = layers.map(\.weight).reduce(0, +)
        guard totalWeight > 0 else { return 0 }

        var sum = 0.0
        for (score, weight) in layers {
            let clamped = max(score, epsilon)
            sum += weight * log(clamped)
        }

        let result = exp(sum / totalWeight)
        // Remap: geometric mean of small numbers is very small.
        // Scale to 0–1 range.
        // With epsilon=0.0001, exp(ln(0.0001)) = 0.0001
        // We want scores to be more spread out.
        return pow(result, 0.5)  // square root to spread the range
    }

    /// Bonus when multiple layers independently detect automation.
    private func computeSynergyBonus(
        _ layers: [(score: Double, weight: Double)],
        _ flags: [DetectionResult.DetectionFlag]
    ) -> Double {
        var bonus = 0.0

        // Count layers above the per-layer alert threshold.
        let alertingLayers = layers.filter { $0.score >= perLayerAlertThreshold }.count
        if alertingLayers >= 3 { bonus += 0.20 }
        else if alertingLayers >= 2 { bonus += 0.10 }

        // Bonus for flag count.
        let uniqueFlagTypes = Set(flags).count
        if uniqueFlagTypes >= 5 { bonus += 0.15 }
        else if uniqueFlagTypes >= 3 { bonus += 0.07 }

        // Bonus for specific high-confidence flag combinations:
        // Virtualization + jailbreak = almost certainly a VM.
        let flagSet = Set(flags)
        if flagSet.contains(.virtualizationDetected) && flagSet.contains(.jailbreakDetected) {
            bonus += 0.15
        }
        // Virtualization + static sensor data = VM with no sensor passthrough.
        if flagSet.contains(.virtualizationDetected) && flagSet.contains(.staticSensorData) {
            bonus += 0.10
        }
        // Perfect curvature + no accidental touches = machine touch injection.
        if flagSet.contains(.perfectCurvature) && flagSet.contains(.noAccidentalTouches) {
            bonus += 0.08
        }

        return min(bonus, 0.35)
    }

    // MARK: - Statistical Outlier Detection

    /// Simple statistical outlier detection using Modified Z-Score.
    ///
    /// More robust than standard Z-score because it uses median and MAD
    /// instead of mean and standard deviation.
    static func isOutlier(
        _ value: Double,
        in samples: [Double],
        threshold: Double = 3.5
    ) -> Bool {
        guard samples.count >= 5 else { return false }
        let sorted = samples.sorted()
        let median = medianOf(sorted)
        let mad = medianAbsoluteDeviation(sorted, median: median)
        guard mad > 0 else { return abs(value - median) > 0.001 }

        let modifiedZ = 0.6745 * (value - median) / mad
        return abs(modifiedZ) > threshold
    }

    static func medianOf(_ sorted: [Double]) -> Double {
        let count = sorted.count
        if count % 2 == 0 {
            return (sorted[count / 2 - 1] + sorted[count / 2]) / 2.0
        } else {
            return sorted[count / 2]
        }
    }

    static func medianAbsoluteDeviation(_ sorted: [Double], median: Double) -> Double {
        let deviations = sorted.map { abs($0 - median) }.sorted()
        return medianOf(deviations)
    }

    /// Compute the Isolation-Forest-inspired anomaly score for a set of feature vectors.
    ///
    /// Simplified approximation: for each feature dimension, compute how many
    /// standard deviations each point is from the median. Aggregate across
    /// dimensions. High aggregate = anomalous.
    ///
    /// Returns scores in [0, 1] where 1 = most anomalous.
    static func anomalyScores(features: [[Double]]) -> [Double] {
        guard !features.isEmpty, !features[0].isEmpty else { return [] }

        let dims = features[0].count
        var dimensionData: [[Double]] = Array(repeating: [], count: dims)
        for vec in features {
            for d in 0..<dims {
                dimensionData[d].append(vec[d])
            }
        }

        var medians: [Double] = []
        var mads: [Double] = []
        for d in 0..<dims {
            let sorted = dimensionData[d].sorted()
            let m = medianOf(sorted)
            medians.append(m)
            mads.append(max(medianAbsoluteDeviation(sorted, median: m), 1e-10))
        }

        return features.map { vec in
            var anomalySum = 0.0
            for d in 0..<dims {
                let z = abs(0.6745 * (vec[d] - medians[d]) / mads[d])
                anomalySum += z
            }
            // Sigmoid to bound in [0, 1]
            let avgZ = anomalySum / Double(dims)
            return 2.0 / (1.0 + exp(-avgZ / 3.0)) - 1.0
        }
    }
}
