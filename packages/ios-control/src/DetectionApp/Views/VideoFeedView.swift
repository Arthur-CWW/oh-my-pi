import SwiftUI
import AVKit

/// TikTok-style vertical video feed.
///
/// Reuses 5 sample videos on loop. Each video occupies the full screen.
/// Swipe up/down navigates between videos.
///
/// Tracked interactions:
/// - Swipe to next/previous video
/// - Double-tap to like
/// - Tap right side to advance
/// - Long press to show context menu
/// - Scroll velocity and deceleration
struct VideoFeedView: View {
    let videos: [VideoItem]
    let behavioralAnalyzer: BehavioralAnalyzer
    let logger: DetectionLogger
    let sessionID: String

    @State private var currentIndex: Int = 0
    @State private var isLiked: Set<String> = []

    // For scroll tracking
    @State private var lastScrollOffset: CGFloat = 0
    @State private var lastScrollTime: Date = Date()

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Video feed — use rotation trick for vertical paging since
                // TabView .page style scrolls horizontally by default.
                // Rotate TabView 90° so horizontal scroll → vertical in screen space;
                // each card counter-rotated -90° to appear upright.
                TabView(selection: $currentIndex) {
                    ForEach(Array(videos.enumerated()), id: \.element.id) { index, video in
                        VideoPlayerView(
                            video: video,
                            isLiked: isLiked.contains(video.id),
                            onLike: { toggleLike(video) },
                            onAdvance: { advanceToNext() },
                            behavioralAnalyzer: behavioralAnalyzer,
                            logger: logger,
                            sessionID: sessionID
                        )
                        .tag(index)
                        .rotationEffect(.degrees(-90))
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .onAppear {
                            logger.log(
                                eventType: .interaction,
                                payload: ["action": "view", "video": video.id],
                                sessionID: sessionID
                            )
                            behavioralAnalyzer.logInteraction(
                                type: .swipeUp,
                                viewID: "video_\(video.id)"
                            )
                        }
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .rotationEffect(.degrees(90))
                .frame(width: geometry.size.width, height: geometry.size.height)
                .ignoresSafeArea()
                .onChange(of: currentIndex) { _, newIndex in
                    let video = videos[newIndex % videos.count]
                    behavioralAnalyzer.logInteraction(
                        type: newIndex > currentIndex ? .swipeUp : .swipeDown,
                        viewID: "video_\(video.id)"
                    )
                    logger.log(
                        eventType: .interaction,
                        payload: [
                            "action": newIndex > currentIndex ? "swipe_up" : "swipe_down",
                            "from": videos[(newIndex - 1 + videos.count) % videos.count].id,
                            "to": video.id,
                        ],
                        sessionID: sessionID
                    )
                }

                // Overlay gradient for text readability
                VStack {
                    Spacer()
                    LinearGradient(
                        gradient: Gradient(colors: [.clear, .black.opacity(0.6)]),
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 200)
                }
                .allowsHitTesting(false)

                // Video info overlay
                VStack {
                    Spacer()
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(videos[currentIndex % videos.count].author)
                                .font(.headline)
                                .foregroundColor(.white)
                            Text(videos[currentIndex % videos.count].title)
                                .font(.subheadline)
                                .foregroundColor(.white.opacity(0.9))
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 40)
                }
                .allowsHitTesting(false)


                // Overlaid interaction buttons (right side)
                VStack {
                    Spacer()
                    HStack {
                        Spacer()
                        VStack(spacing: 24) {
                            InteractionButton(
                                icon: "heart.fill",
                                count: videos[currentIndex % videos.count].likes,
                                isActive: isLiked.contains(videos[currentIndex % videos.count].id),
                                action: {
                                    toggleLike(videos[currentIndex % videos.count])
                                }
                            )
                            InteractionButton(
                                icon: "message.fill",
                                count: videos[currentIndex % videos.count].comments,
                                isActive: false,
                                action: {
                                    logger.log(
                                        eventType: .interaction,
                                        payload: ["action": "comments_tap"],
                                        sessionID: sessionID
                                    )
                                }
                            )
                            InteractionButton(
                                icon: "arrowshape.turn.up.forward.fill",
                                count: videos[currentIndex % videos.count].shares,
                                isActive: false,
                                action: {
                                    logger.log(
                                        eventType: .interaction,
                                        payload: ["action": "share_tap"],
                                        sessionID: sessionID
                                    )
                                }
                            )
                        }
                        .padding(.trailing, 12)
                        .padding(.bottom, 40)
                    }
                }
                .allowsHitTesting(true)
            }
        }
    }

    private func toggleLike(_ video: VideoItem) {
        if isLiked.contains(video.id) {
            isLiked.remove(video.id)
        } else {
            isLiked.insert(video.id)
            // Double-tap-like simulation
            behavioralAnalyzer.logInteraction(type: .doubleTap, viewID: "video_\(video.id)")
            logger.log(
                eventType: .interaction,
                payload: ["action": "like", "video": video.id],
                sessionID: sessionID
            )
        }
    }

    private func advanceToNext() {
        let next = (currentIndex + 1) % videos.count
        withAnimation {
            currentIndex = next
        }
        behavioralAnalyzer.logInteraction(type: .tap, viewID: "video_\(videos[next].id)")
    }
}

// MARK: - Video Player

struct VideoPlayerView: View {
    let video: VideoItem
    let isLiked: Bool
    let onLike: () -> Void
    let onAdvance: () -> Void
    let behavioralAnalyzer: BehavioralAnalyzer
    let logger: DetectionLogger
    let sessionID: String

    @State private var player: AVPlayer?
    @State private var showHeart = false

    var body: some View {
        ZStack {
            // Video placeholder — in a real app, load from bundle.
            // For this prototype, show a colored placeholder with video info.
            Rectangle()
                .fill(
                    LinearGradient(
                        gradient: Gradient(colors: [
                            Color(hue: Double(video.id.hashValue % 360) / 360.0, saturation: 0.7, brightness: 0.4),
                            Color(hue: Double(video.id.hashValue % 360) / 360.0, saturation: 0.5, brightness: 0.2),
                        ]),
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay {
                    VStack(spacing: 16) {
                        Image(systemName: "play.rectangle.fill")
                            .font(.system(size: 48))
                            .foregroundColor(.white.opacity(0.5))

                        Text(video.title)
                            .font(.title3)
                            .foregroundColor(.white.opacity(0.7))
                            .multilineTextAlignment(.center)

                        Text(video.author)
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.4))

                        Text("\(String(format: "%.0f", video.duration))s sample video")
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.3))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 6)
                            .background(.ultraThinMaterial)
                            .clipShape(Capsule())
                    }
                }

            // Tap right half to advance
            HStack {
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture(count: 2) {
                        onLike()
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                            showHeart = true
                        }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                            withAnimation { showHeart = false }
                        }
                    }
                Color.clear
                    .contentShape(Rectangle())
                    .onTapGesture {
                        onAdvance()
                        behavioralAnalyzer.logInteraction(type: .tap, viewID: "video_\(video.id)_advance")
                        logger.log(
                            eventType: .interaction,
                            payload: ["action": "tap_advance"],
                            sessionID: sessionID
                        )
                    }
            }

            // Like heart animation
            if showHeart {
                Image(systemName: "heart.fill")
                    .font(.system(size: 80))
                    .foregroundColor(.white)
                    .shadow(color: .red.opacity(0.5), radius: 20)
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .onAppear {
            // In a real app, load and play the video.
            // Here we just mark the view as visited.
            logger.log(
                eventType: .interaction,
                payload: ["action": "video_appear", "video": video.id],
                sessionID: sessionID
            )
        }
    }
}

// MARK: - Interaction Button

struct InteractionButton: View {
    let icon: String
    let count: Int
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 28))
                    .foregroundColor(isActive ? .red : .white)
                Text(formatCount(count))
                    .font(.caption2)
                    .foregroundColor(.white)
            }
        }
        .buttonStyle(.plain)
    }

    private func formatCount(_ count: Int) -> String {
        if count >= 1_000_000 {
            return String(format: "%.1fM", Double(count) / 1_000_000)
        } else if count >= 1_000 {
            return String(format: "%.1fK", Double(count) / 1_000)
        }
        return "\(count)"
    }
}
