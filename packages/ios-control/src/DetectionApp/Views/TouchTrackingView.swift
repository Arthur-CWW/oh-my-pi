import SwiftUI
import UIKit

/// A UIView that captures all touch events for biometric analysis.
///
/// This wraps the SwiftUI content and intercepts UITouch events at the
/// UIView level, where we have access to full UITouch properties
/// (force, majorRadius, altitudeAngle, etc.) that SwiftUI gestures don't expose.
///
/// Usage:
/// ```swift
/// TouchTrackingView(analyzer: touchAnalyzer, logger: logger, sessionID: sessionID) {
///     VideoFeedView(...)
/// }
/// ```
struct TouchTrackingView<Content: View>: UIViewRepresentable {
    let analyzer: TouchBiometricsAnalyzer
    let logger: DetectionLogger
    let sessionID: String
    let content: Content

    func makeUIView(context: Context) -> TouchCapturingHostView<Content> {
        let host = TouchCapturingHostView<Content>(
            analyzer: analyzer,
            logger: logger,
            sessionID: sessionID
        )
        host.setContent(content)
        return host
    }

    func updateUIView(_ uiView: TouchCapturingHostView<Content>, context: Context) {
        uiView.setContent(content)
        uiView.analyzer = analyzer
        uiView.logger = logger
        uiView.sessionID = sessionID
    }
}

/// UIView subclass that overrides touch handling to capture all events.
final class TouchCapturingHostView<Content: View>: UIView {
    var analyzer: TouchBiometricsAnalyzer
    var logger: DetectionLogger
    var sessionID: String

    private var hostingController: UIHostingController<Content>?

    init(
        analyzer: TouchBiometricsAnalyzer,
        logger: DetectionLogger,
        sessionID: String,
        frame: CGRect = .zero
    ) {
        self.analyzer = analyzer
        self.logger = logger
        self.sessionID = sessionID
        super.init(frame: frame)
        isMultipleTouchEnabled = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) not supported")
    }

    func setContent(_ content: Content) {
        if let hc = hostingController {
            hc.rootView = content
        } else {
            let hc = UIHostingController(rootView: content)
            hc.view.frame = bounds
            hc.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            hc.view.backgroundColor = .black
            addSubview(hc.view)
            hostingController = hc
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        hostingController?.view.frame = bounds
    }

    // MARK: - Touch Capture

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let event = event {
            analyzer.ingest(event: event, in: self)
        }
        for touch in touches {
            let loc = touch.location(in: self)
            logger.log(
                eventType: .touchBegan,
                payload: [
                    "id": "\(Unmanaged.passUnretained(touch).toOpaque())",
                    "x": String(format: "%.1f", loc.x),
                    "y": String(format: "%.1f", loc.y),
                    "force": String(format: "%.3f", touch.force),
                    "radius": String(format: "%.2f", touch.majorRadius),
                ],
                sessionID: sessionID
            )
        }
        super.touchesBegan(touches, with: event)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let event = event {
            analyzer.ingest(event: event, in: self)
        }
        for touch in touches {
            let loc = touch.location(in: self)
            logger.log(
                eventType: .touchMoved,
                payload: [
                    "id": "\(Unmanaged.passUnretained(touch).toOpaque())",
                    "x": String(format: "%.1f", loc.x),
                    "y": String(format: "%.1f", loc.y),
                ],
                sessionID: sessionID
            )
        }
        super.touchesMoved(touches, with: event)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let event = event {
            analyzer.ingest(event: event, in: self)
        }
        for touch in touches {
            logger.log(
                eventType: .touchEnded,
                payload: [
                    "id": "\(Unmanaged.passUnretained(touch).toOpaque())",
                ],
                sessionID: sessionID
            )
        }
        super.touchesEnded(touches, with: event)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let event = event {
            analyzer.ingest(event: event, in: self)
        }
        for touch in touches {
            logger.log(
                eventType: .touchCancelled,
                payload: [
                    "id": "\(Unmanaged.passUnretained(touch).toOpaque())",
                ],
                sessionID: sessionID
            )
        }
        super.touchesCancelled(touches, with: event)
    }
}
