import Foundation
import OSLog

/// Structured event logger for post-hoc analysis.
///
/// Persists interaction events and detection results to a JSON-lines file
/// in the app's documents directory. Each line is a standalone JSON object
/// for append-only, crash-safe logging.
///
/// Also duplicates critical events to OSLog for Console.app inspection.
final class DetectionLogger {
    private let fileURL: URL
    private let fileHandle: FileHandle?
    private let encoder = JSONEncoder()
    private let queue = DispatchQueue(label: "com.detection.logger", qos: .utility)
    private let osLogger = Logger(subsystem: "com.detection.app", category: "detection")

    private(set) var eventCount: Int = 0

    init() {
        encoder.outputFormatting = [.sortedKeys]

        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let logDir = docs.appendingPathComponent("DetectionLogs")
        try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)

        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let filename = "detection_\(dateFormatter.string(from: Date())).jsonl"
        fileURL = logDir.appendingPathComponent(filename)

        if !FileManager.default.fileExists(atPath: fileURL.path) {
            FileManager.default.createFile(atPath: fileURL.path, contents: nil)
        }
        fileHandle = try? FileHandle(forWritingTo: fileURL)
        fileHandle?.seekToEndOfFile()

        osLogger.info("DetectionLogger initialized: \(self.fileURL.path)")
    }

    deinit {
        fileHandle?.closeFile()
    }

    // MARK: - Event Types

    enum EventType: String, Codable {
        case touchBegan
        case touchMoved
        case touchEnded
        case touchCancelled
        case interaction
        case scroll
        case keystroke
        case scoreUpdate
        case envCheck
        case sessionStart
        case sessionEnd
    }

    struct LogEntry: Codable {
        let timestamp: Date
        let eventType: EventType
        let payload: [String: String]
        let sessionID: String
    }

    // MARK: - Logging

    func log(
        eventType: EventType,
        payload: [String: String] = [:],
        sessionID: String
    ) {
        let entry = LogEntry(
            timestamp: Date(),
            eventType: eventType,
            payload: payload,
            sessionID: sessionID
        )

        queue.async { [weak self] in
            guard let self = self else { return }
            do {
                var data = try self.encoder.encode(entry)
                data.append(0x0A)  // newline
                self.fileHandle?.write(data)
                self.eventCount += 1
            } catch {
                self.osLogger.error("Failed to write log entry: \(error.localizedDescription)")
            }
        }

        // Also to OSLog for real-time Console monitoring.
        let payloadDescription = payload
            .map { "\($0.key)=\($0.value)" }
            .sorted()
            .joined(separator: " ")
        osLogger.debug("[\(sessionID, privacy: .public)] \(eventType.rawValue, privacy: .public): \(payloadDescription, privacy: .public)")
    }

    // MARK: - Score Snapshots

    func logScore(_ snapshot: ScoreSnapshot, sessionID: String) {
        let payload: [String: String] = [
            "touch": String(format: "%.4f", snapshot.touch),
            "behavioral": String(format: "%.4f", snapshot.behavioral),
            "environmental": String(format: "%.4f", snapshot.environmental),
            "composite": String(format: "%.4f", snapshot.composite),
            "risk": snapshot.riskLevel.rawValue,
            "flags": snapshot.flags.map(\.rawValue).joined(separator: ","),
        ]
        log(eventType: .scoreUpdate, payload: payload, sessionID: sessionID)
    }

    // MARK: - Reading

    /// Read all events for a session from the log file.
    func readEvents() -> [LogEntry] {
        guard let data = try? Data(contentsOf: fileURL) else { return [] }
        let lines = String(data: data, encoding: .utf8)?.split(separator: "\n") ?? []
        let decoder = JSONDecoder()
        return lines.compactMap { line in
            try? decoder.decode(LogEntry.self, from: Data(line.utf8))
        }
    }

    /// Path to the log file — can be shared via AirDrop, Files, etc.
    var logFilePath: String { fileURL.path }
}
