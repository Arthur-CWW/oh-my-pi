import UIKit

/// A captured touch event with all biometric-relevant properties.
struct TouchEvent: Codable {
    let id: String
    let timestamp: TimeInterval
    let phase: Phase
    let location: CGPoint
    let previousLocation: CGPoint?
    let force: CGFloat
    let maximumPossibleForce: CGFloat
    let majorRadius: CGFloat
    let majorRadiusTolerance: CGFloat
    let altitudeAngle: CGFloat        // stylus — 0 = parallel, π/2 = perpendicular
    let azimuthAngle: CGFloat         // stylus orientation
    let estimationUpdateIndex: Int?   // coalesced touch index
    let type: TouchType

    enum Phase: String, Codable {
        case began, moved, stationary, ended, cancelled, unknown
    }

    enum TouchType: String, Codable {
        case direct    // finger on screen
        case indirect  // pointer (not finger)
        case pencil    // Apple Pencil
        case unknown
    }

    /// Distance traveled since the previous event.
    var displacement: CGFloat {
        guard let prev = previousLocation else { return 0 }
        let dx = location.x - prev.x
        let dy = location.y - prev.y
        return sqrt(dx * dx + dy * dy)
    }

    /// Normalized force (0–1).
    var normalizedForce: CGFloat {
        maximumPossibleForce > 0 ? force / maximumPossibleForce : 0
    }
}

/// A complete touch sequence from began → (moved*) → ended/cancelled.
struct TouchSequence: Codable {
    let touchID: String
    var events: [TouchEvent]
    var startTime: TimeInterval { events.first?.timestamp ?? 0 }
    var endTime: TimeInterval { events.last?.timestamp ?? 0 }
    var duration: TimeInterval { endTime - startTime }

    /// Total path length (sum of displacements).
    var pathLength: CGFloat {
        var total: CGFloat = 0
        for i in 1..<events.count {
            let a = events[i - 1].location
            let b = events[i].location
            let dx = b.x - a.x
            let dy = b.y - a.y
            total += sqrt(dx * dx + dy * dy)
        }
        return total
    }

    /// Straight-line distance from start to end.
    var straightLineDistance: CGFloat {
        guard let first = events.first, let last = events.last else { return 0 }
        let dx = last.location.x - first.location.x
        let dy = last.location.y - first.location.y
        return sqrt(dx * dx + dy * dy)
    }

    /// Curvature metric: pathLength / straightLineDistance.
    /// 1.0 = perfectly straight; > 1.0 = curved.
    /// Machines drawing Bezier curves produce values in a narrow, unnatural range.
    var curvatureRatio: CGFloat {
        let sld = straightLineDistance
        guard sld > 0 else { return 1.0 }
        return pathLength / sld
    }

    /// Force samples over the touch duration.
    var forceSamples: [CGFloat] { events.map(\.force) }

    /// Radius samples over the touch duration.
    var radiusSamples: [CGFloat] { events.map(\.majorRadius) }

    /// Inter-event timing deltas in milliseconds.
    var interEventDeltasMs: [Double] {
        guard events.count > 1 else { return [] }
        var deltas: [Double] = []
        for i in 1..<events.count {
            deltas.append((events[i].timestamp - events[i - 1].timestamp) * 1000)
        }
        return deltas
    }
}
