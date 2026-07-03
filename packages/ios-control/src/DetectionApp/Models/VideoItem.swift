import Foundation

/// A TikTok-style video item for the feed.
struct VideoItem: Identifiable {
    let id: String
    let filename: String      // bundled MP4 filename
    let title: String
    let author: String
    let duration: TimeInterval
    var likes: Int
    var comments: Int
    var shares: Int

    static let samples: [VideoItem] = [
        VideoItem(
            id: "v1", filename: "sample1", title: "Morning coffee routine ☕️",
            author: "@coffeelover", duration: 15.0, likes: 1234, comments: 89, shares: 45
        ),
        VideoItem(
            id: "v2", filename: "sample2", title: "Sunset timelapse 🌅",
            author: "@naturevibes", duration: 20.0, likes: 5678, comments: 234, shares: 123
        ),
        VideoItem(
            id: "v3", filename: "sample3", title: "Quick workout tip 💪",
            author: "@fitnessguru", duration: 12.0, likes: 3456, comments: 156, shares: 78
        ),
        VideoItem(
            id: "v4", filename: "sample4", title: "Cooking hack you need 🍳",
            author: "@chefmode", duration: 18.0, likes: 7890, comments: 345, shares: 210
        ),
        VideoItem(
            id: "v5", filename: "sample5", title: "Pet compilation 🐕",
            author: "@doglover", duration: 22.0, likes: 9012, comments: 456, shares: 267
        ),
    ]
}

/// Interaction type tracked for behavioral analysis.
enum InteractionType: String, Codable {
    case tap
    case doubleTap
    case longPress
    case swipeUp
    case swipeDown
    case swipeLeft
    case swipeRight
    case pinch
    case scroll
}
