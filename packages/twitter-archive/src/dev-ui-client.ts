import type {
  DevUiLogEventView,
  DevUiMediaView,
  DevUiQuotedTweetView,
  DevUiState,
  DevUiTweetAttributeName,
  DevUiTweetGroupView,
  DevUiUserView,
  DevUiTweetView,
} from "./dev-ui-server"
import { buildTweetGroupMarkdown } from "./dev-ui-markdown"
import type { SqliteCaptureJob } from "./sqlite-store"

type ActiveLane = "tweets" | "media" | "jobs"
type TweetSortMode = "latest" | "likes" | "replies" | "reposts" | "quotes" | "views"
type TweetMetricSortMode = Exclude<TweetSortMode, "latest">
type TweetFilterKey = "media" | "quotes" | "replies" | "localNotes" | "bookmarks" | "attributes"
type FrontendLogDetails = { readonly [key: string]: string | number | boolean | null }
type ProfileSummary = {
  readonly id: string
  readonly username?: string
  readonly displayName?: string
  readonly avatarUrl?: string
  readonly description?: string
  readonly tweetCount: number
  readonly latestTweetAt?: string
}

const TWEET_FILTERS: ReadonlyArray<readonly [TweetFilterKey, string]> = [
  ["media", "Media"],
  ["quotes", "Quotes"],
  ["replies", "Replies"],
  ["localNotes", "Local notes"],
  ["bookmarks", "Bookmarks"],
  ["attributes", "Attributes"],
]


const app = requireElement("app")
const searchInput = document.createElement("input")
const sortSelect = document.createElement("select")
const sinceInput = document.createElement("input")
const untilInput = document.createElement("input")
const controlsToggleButton = document.createElement("button")
const summaryElement = document.createElement("section")
const controlsElement = document.createElement("section")
const filterControlsElement = document.createElement("div")
const profileElement = document.createElement("section")
const laneTitle = document.createElement("h2")
const laneSubtitle = document.createElement("p")
const contentElement = document.createElement("div")
const updatedElement = document.createElement("span")
const toastElement = document.createElement("div")
const helpDialog = document.createElement("dialog")
const tabButtons = new Map<ActiveLane, HTMLButtonElement>()

let activeLane: ActiveLane = "tweets"
let filterText = ""
let tweetSortMode: TweetSortMode = "latest"
let sinceFilter = ""
let untilFilter = ""
let activeTweetFilters = new Set<TweetFilterKey>()
let activeProfileId: string | undefined = profileIdFromLocation()
let activeSelectionGroupId: string | undefined
let latestState: DevUiState | undefined
let lastError: string | undefined
let eventSource: EventSource | undefined
let controlsExpanded = false
let toastTimer: number | undefined
bootstrap()
void refreshState("initial_load")
connectStateStream()
logFrontend("dev_ui_client_loaded")

function bootstrap(): void {
  searchInput.type = "search"
  searchInput.placeholder = "Search text, authors, media, quotes, jobs, logs"
  searchInput.autocomplete = "off"
  searchInput.addEventListener("input", () => {
    filterText = searchInput.value.trim().toLocaleLowerCase()
    render()
  })
  setupTweetControls()

  controlsToggleButton.className = "tab controls-toggle"
  controlsToggleButton.type = "button"
  controlsToggleButton.textContent = "Filters"
  controlsToggleButton.title = "Toggle filters (f), open search (/)"
  controlsToggleButton.addEventListener("click", toggleControlsPanel)

  const topbar = el("header", { className: "topbar" }, [
    el("div", { className: "brand" }, [el("h1", { text: "Twitter archive" }), el("p", { text: "Local archive" })]),
    buildTabs(),
    controlsToggleButton,
    el("button", { className: "tab", text: "?" }, [], { title: "Keyboard shortcuts", type: "button" }),
  ])
  const helpButton = topbar.querySelector<HTMLButtonElement>("button[title='Keyboard shortcuts']")
  helpButton?.addEventListener("click", showHelp)

  summaryElement.className = "summary"
  controlsElement.className = "controls-panel"
  syncControlsPanelVisibility()
  profileElement.className = "profile-panel"
  contentElement.className = "content"
  updatedElement.className = "shortcut"
  toastElement.className = "toast"
  toastElement.setAttribute("role", "status")
  toastElement.hidden = true

  const lane = el("main", { className: "lane-grid" }, [
    el("section", { className: "lane", attrs: { "aria-live": "polite" } }, [
      el("div", { className: "lane-header" }, [el("div", {}, [laneTitle, laneSubtitle]), updatedElement]),
      controlsElement,
      summaryElement,
      profileElement,
      contentElement,
    ]),
  ])

  buildHelpDialog()
  app.replaceChildren(topbar, lane, toastElement, helpDialog)
  document.addEventListener("keydown", handleShortcut)
  window.addEventListener("popstate", handleHistoryNavigation)
}

function buildTabs(): HTMLElement {
  const tabs = el("nav", { className: "tabs", attrs: { "aria-label": "Archive lanes" } })
  const tabDefinitions: ReadonlyArray<readonly [ActiveLane, string]> = [
    ["tweets", "1 Tweets"],
    ["media", "2 Media"],
    ["jobs", "3 Jobs/logs"],
  ]

  for (const [lane, label] of tabDefinitions) {
    const button = el("button", { className: "tab", text: label }, [], { type: "button" })
    button.addEventListener("click", () => setLane(lane))
    tabButtons.set(lane, button)
    tabs.append(button)
  }

  return tabs
}

function setupTweetControls(): void {
  sortSelect.append(
    option("latest", "Latest"),
    option("likes", "Likes"),
    option("replies", "Replies"),
    option("reposts", "Reposts"),
    option("quotes", "Quotes"),
    option("views", "Views"),
  )
  sortSelect.addEventListener("change", () => {
    tweetSortMode = sortSelect.value as TweetSortMode
    render()
  })

  sinceInput.type = "date"
  sinceInput.addEventListener("input", () => {
    sinceFilter = sinceInput.value
    render()
  })
  untilInput.type = "date"
  untilInput.addEventListener("input", () => {
    untilFilter = untilInput.value
    render()
  })

  filterControlsElement.className = "filter-chips"
  for (const [key, label] of TWEET_FILTERS) {
    const checkbox = document.createElement("input")
    checkbox.type = "checkbox"
    checkbox.addEventListener("change", () => {
      const nextFilters = new Set(activeTweetFilters)
      if (checkbox.checked) {
        nextFilters.add(key)
      } else {
        nextFilters.delete(key)
      }
      activeTweetFilters = nextFilters
      render()
    })
    filterControlsElement.append(el("label", { className: "filter-chip" }, [checkbox, document.createTextNode(label)]))
  }

  controlsElement.replaceChildren(
    el("label", { className: "control-field search-field" }, [el("span", { text: "Search" }), searchInput]),
    el("label", { className: "control-field" }, [el("span", { text: "Sort" }), sortSelect]),
    el("label", { className: "control-field" }, [el("span", { text: "Since" }), sinceInput]),
    el("label", { className: "control-field" }, [el("span", { text: "Until" }), untilInput]),
    filterControlsElement,
  )
}

function toggleControlsPanel(): void {
  controlsExpanded = !controlsExpanded
  syncControlsPanelVisibility()
}

function expandControlsPanel(): void {
  if (!controlsExpanded) {
    controlsExpanded = true
    syncControlsPanelVisibility()
  }
}

function syncControlsPanelVisibility(): void {
  controlsElement.hidden = activeLane !== "tweets" || !controlsExpanded
  controlsToggleButton.setAttribute("aria-expanded", String(controlsExpanded))
  controlsToggleButton.textContent = controlsExpanded ? "Hide filters" : "Filters"
}

function option(value: TweetSortMode, label: string): HTMLOptionElement {
  const element = document.createElement("option")
  element.value = value
  element.textContent = label
  return element
}

async function refreshState(reason: string): Promise<void> {
  try {
    const response = await fetch("/api/state", { headers: { Accept: "application/json" } })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    latestState = (await response.json()) as DevUiState
    lastError = undefined
    render()
    logFrontend("dev_ui_refreshed", { reason })
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error)
    render()
  }
}

function connectStateStream(): void {
  if (!("EventSource" in window)) {
    return
  }

  eventSource?.close()
  eventSource = new EventSource("/api/stream")
  eventSource.addEventListener("state", (event) => {
    latestState = JSON.parse(event.data) as DevUiState
    lastError = undefined
    render()
  })
  eventSource.addEventListener("error", () => {
    lastError = "Live updates disconnected; polling refresh still works."
  })
}

function render(): void {
  for (const [lane, button] of tabButtons) {
    button.setAttribute("aria-selected", String(lane === activeLane))
  }
  syncControlsPanelVisibility()

  if (!latestState) {
    laneTitle.textContent = "Loading archive"
    laneSubtitle.textContent = lastError ? `Waiting for data: ${lastError}` : "Reading SQLite and JSONL state"
    updatedElement.textContent = ""
    summaryElement.replaceChildren()
    profileElement.replaceChildren()
    contentElement.replaceChildren(el("div", { className: "empty", text: "No state loaded yet." }))
    return
  }

  updatedElement.textContent = `Updated ${formatDate(latestState.summary.generatedAt)}`
  renderSummary(latestState)
  if (activeLane === "tweets") {
    renderTweets(latestState.tweetGroups)
  } else {
    profileElement.replaceChildren()
    if (activeLane === "media") renderMedia(latestState.media)
    if (activeLane === "jobs") renderJobsAndLogs(latestState.jobs, latestState.events)
  }
}

function renderSummary(state: DevUiState): void {
  const summary = state.summary
  summaryElement.replaceChildren(
    metric("Tweets", summary.counts.tweets),
    metric("Media", summary.counts.media),
    metric("Jobs", summary.counts.captureJobs),
    metric("Running", summary.jobs.running),
    metric("Downloaded", summary.media.downloaded),
    metric("Following edges", state.socialGraph.followingEdges),
  )
}

function renderTweets(groups: readonly DevUiTweetGroupView[]): void {
  const filtered = visibleTweetGroups(groups)
  const profile = activeProfileId ? profileSummaryFor(activeProfileId, groups) : undefined
  laneTitle.textContent = profile ? profileLabel(profile) : "Home"
  laneSubtitle.textContent = profile
    ? `${filtered.length} visible local tweet group${filtered.length === 1 ? "" : "s"}`
    : "Read-only archive feed. Press f for filters, / for search, y to copy."
  renderProfilePanel(profile, filtered.length)

  if (filtered.length === 0) {
    contentElement.replaceChildren(emptyState(profile ? "No tweets match this profile and text filter." : "No tweets match the current filter."))
    return
  }

  contentElement.replaceChildren(...filtered.map(renderTweetGroup))
}

function renderTweetGroup(group: DevUiTweetGroupView): HTMLElement {
  const selected = group.groupId === activeSelectionGroupId
  const card = el("article", { className: selected ? "card feed-card selected" : "card feed-card", attrs: { "data-group-id": group.groupId, "aria-current": String(selected) } }, [
    el("div", { className: "meta group-meta" }, [
      selected ? pill("selected · y copies Markdown") : pill("click or j/k to select"),
      pill(group.kind),
      pill(`${group.tweets.length} tweet${group.tweets.length === 1 ? "" : "s"}`),
      pill(formatDate(group.latestAt)),
    ]),
  ])
  card.addEventListener("click", (event) => {
    if (isInteractiveTarget(event.target)) return
    activeSelectionGroupId = group.groupId
    render()
  })

  for (const tweet of group.tweets) {
    card.append(renderTweet(tweet))
  }

  return card
}

function renderTweet(tweet: DevUiTweetView): HTMLElement {
  const classes = tweet.replyDepth > 0 ? "tweet feed-row reply" : "tweet feed-row"
  const user = userForTweet(tweet)
  const handle = tweet.username ? `@${tweet.username}` : tweet.authorId
  const displayName = user?.displayName ?? tweet.username ?? tweet.authorId

  return el("article", { className: classes }, [
    renderAvatar(user, displayName),
    el("div", { className: "feed-body" }, [
      renderRetweetContext(tweet),
      renderTweetHeader(tweet, displayName, handle),
      renderReplyContext(tweet),
      el("p", { text: tweet.text }),
      renderQuotedTweet(tweet),
      renderMediaGrid(tweet.media),
      renderMetrics(tweet),
      renderAnnotationActions(tweet),
    ]),
  ])
}

function renderAvatar(user: DevUiUserView | undefined, displayName: string): HTMLElement {
  const fallback = displayName.slice(0, 1).toLocaleUpperCase()
  return el("div", { className: "avatar" }, [
    user?.avatarUrl ? el("img", { attrs: { src: user.avatarUrl, alt: displayName } }) : document.createTextNode(fallback),
  ])
}

function renderAuthorButton(tweet: DevUiTweetView, displayName: string, handle: string): HTMLElement {
  const button = el("button", { className: "author-button" }, [
    el("strong", { text: displayName }),
    el("span", { text: handle }),
  ], { type: "button", title: "Show local profile" })
  button.addEventListener("click", () => openProfile(tweet))
  return button
}

function renderTweetHeader(tweet: DevUiTweetView, displayName: string, handle: string): HTMLElement {
  return el("div", { className: "feed-author" }, [
    renderAuthorButton(tweet, displayName, handle),
    el("span", { text: "·" }),
    el("a", {
      text: tweet.createdAt ? formatDate(tweet.createdAt) : "no created_at",
      attrs: { href: tweet.url, target: "_blank", rel: "noreferrer" },
    }),
  ])
}

function renderRetweetContext(tweet: DevUiTweetView): Node {
  if (!tweet.retweetedBy) {
    return document.createTextNode("")
  }

  const retweeter = tweet.retweetedBy.displayName ?? (tweet.retweetedBy.username ? `@${tweet.retweetedBy.username}` : "Archived account")
  return el("div", { className: "retweet-context", text: `${retweeter} reposted` })
}

function renderReplyContext(tweet: DevUiTweetView): Node {
  if (!tweet.inReplyToTweetId && !tweet.replyToUsername && !tweet.inReplyToUserId) {
    return document.createTextNode("")
  }

  const label = tweet.replyToUsername
    ? `@${tweet.replyToUsername}`
    : tweet.inReplyToUserId
      ? `@${tweet.inReplyToUserId}`
      : `tweet ${tweet.inReplyToTweetId}`
  const children: Node[] = [document.createTextNode("Replying to ")]
  if (tweet.inReplyToTweetId) {
    const href = tweet.replyToUsername
      ? `https://x.com/${encodeURIComponent(tweet.replyToUsername)}/status/${encodeURIComponent(tweet.inReplyToTweetId)}`
      : `https://x.com/i/web/status/${encodeURIComponent(tweet.inReplyToTweetId)}`
    children.push(el("a", { text: label, attrs: { href, target: "_blank", rel: "noreferrer" } }))
  } else {
    children.push(document.createTextNode(label))
  }
  return el("div", { className: "reply-context" }, children)
}

function renderProfilePanel(profile: ProfileSummary | undefined, visibleGroupCount: number): void {
  if (!profile) {
    profileElement.replaceChildren()
    return
  }

  const clearButton = el("button", { className: "annotation-button", text: "Back to all tweets" }, [], {
    type: "button",
    title: "Clear profile filter",
  })
  clearButton.addEventListener("click", () => clearProfileFilter("button"))

  const children: Node[] = [
    el("div", { className: "profile-cover" }),
    el("div", { className: "profile-heading" }, [
      renderProfileAvatar(profile),
      el("div", { className: "profile-title" }, [
        profile.displayName ? el("strong", { text: profile.displayName }) : document.createTextNode(""),
        el("span", { text: profile.username ? `@${profile.username}` : profile.id }),
      ]),
      clearButton,
    ]),
    el("div", { className: "meta" }, [
      pill(`${profile.tweetCount} archived tweet${profile.tweetCount === 1 ? "" : "s"}`),
      pill(`${visibleGroupCount} visible group${visibleGroupCount === 1 ? "" : "s"}`),
      profile.latestTweetAt ? pill(`latest ${formatDate(profile.latestTweetAt)}`) : pill("no archived tweets"),
    ]),
  ]

  if (profile.description) {
    children.push(el("p", { text: profile.description }))
  }
  profileElement.replaceChildren(...children)
}

function renderProfileAvatar(profile: ProfileSummary): HTMLElement {
  const displayName = profile.displayName ?? profile.username ?? profile.id
  return el("div", { className: "avatar profile-avatar" }, [
    profile.avatarUrl ? el("img", { attrs: { src: profile.avatarUrl, alt: displayName } }) : document.createTextNode(displayName.slice(0, 1).toLocaleUpperCase()),
  ])
}

function renderMedia(media: readonly DevUiMediaView[]): void {
  const filtered = media.filter(mediaMatchesFilter)
  laneTitle.textContent = "Media"
  laneSubtitle.textContent = "Remote URLs, local paths, and idempotent download status from archive records."

  if (filtered.length === 0) {
    contentElement.replaceChildren(emptyState("No media rows match the current filter."))
    return
  }

  contentElement.replaceChildren(...filtered.map(renderMediaCard))
}

function renderMediaCard(media: DevUiMediaView): HTMLElement {
  return el("article", { className: "card" }, [
    el("h3", { text: `${media.type} media` }),
    el("div", { className: "meta" }, [pill(media.id), pill(`tweet ${media.tweetId}`), statusPill(media.downloadStatus)]),
    el("div", { className: "media-card-preview" }, [renderMediaGrid([media])]),
    renderMediaDetails(media),
  ])
}

function renderJobsAndLogs(jobs: readonly SqliteCaptureJob[], events: readonly DevUiLogEventView[]): void {
  const filteredJobs = jobs.filter(jobMatchesFilter)
  const filteredEvents = events.filter(eventMatchesFilter)
  laneTitle.textContent = "Jobs and logs"
  laneSubtitle.textContent = "Capture progress, worker stages, and recent JSONL events."

  const children: Node[] = []
  children.push(el("h3", { text: "Capture jobs" }))
  children.push(...(filteredJobs.length > 0 ? filteredJobs.map(renderJob) : [emptyState("No jobs match the current filter.")]))
  children.push(el("h3", { text: "Recent events" }))
  children.push(...(filteredEvents.length > 0 ? filteredEvents.map(renderEvent) : [emptyState("No events match the current filter.")]))
  contentElement.replaceChildren(...children)
}

function renderJob(job: SqliteCaptureJob): HTMLElement {
  return el("article", { className: "card" }, [
    el("h3", { text: job.target }),
    el("div", { className: "meta" }, [
      pill(job.id),
      statusPill(job.status),
      pill(job.stage),
      pill(`${job.attempts} attempt${job.attempts === 1 ? "" : "s"}`),
      pill(formatDate(job.updatedAt)),
    ]),
    job.error ? el("p", { text: job.error }) : document.createTextNode(""),
  ])
}

function renderEvent(event: DevUiLogEventView): HTMLElement {
  const detailText = event.details ? JSON.stringify(event.details) : event.parseError
  return el("article", { className: "card" }, [
    el("h3", { text: event.event ?? `Line ${event.lineNumber}` }),
    el("div", { className: "meta" }, [
      pill(event.component ?? "unknown"),
      event.level ? statusPill(event.level) : pill("no level"),
      pill(event.timestamp ? formatDate(event.timestamp) : `line ${event.lineNumber}`),
      event.jobId ? pill(`job ${event.jobId}`) : document.createTextNode(""),
    ]),
    detailText ? el("p", { text: detailText }) : document.createTextNode(""),
  ])
}

function setLane(lane: ActiveLane): void {
  activeLane = lane
  render()
  logFrontend("dev_ui_lane_selected", { lane })
}

function openProfile(tweet: DevUiTweetView): void {
  activeProfileId = tweet.authorId
  activeLane = "tweets"
  activeSelectionGroupId = undefined
  pushProfileHistory(tweet.authorId)
  render()
  logFrontend("dev_ui_profile_selected", { userId: tweet.authorId, username: tweet.username ?? null })
}

function clearProfileFilter(reason: string): void {
  if (!activeProfileId) return
  activeProfileId = undefined
  activeSelectionGroupId = undefined
  clearProfileHistory()
  render()
  logFrontend("dev_ui_profile_cleared", { reason })
}

function handleHistoryNavigation(): void {
  activeProfileId = profileIdFromLocation()
  if (activeProfileId) {
    activeLane = "tweets"
  }
  activeSelectionGroupId = undefined
  render()
}

function pushProfileHistory(userId: string): void {
  const nextUrl = new URL(window.location.href)
  nextUrl.hash = `profile=${encodeURIComponent(userId)}`
  if (nextUrl.href !== window.location.href) {
    window.history.pushState({ profile: userId }, "", nextUrl)
  }
}

function clearProfileHistory(): void {
  if (!profileIdFromLocation()) return
  const nextUrl = new URL(window.location.href)
  nextUrl.hash = ""
  window.history.replaceState({}, "", nextUrl)
}

function profileIdFromLocation(): string | undefined {
  const prefix = "#profile="
  if (!window.location.hash.startsWith(prefix)) {
    return undefined
  }
  const encoded = window.location.hash.slice(prefix.length)
  try {
    return encoded ? decodeURIComponent(encoded) : undefined
  } catch {
    return undefined
  }
}

function moveActiveSelection(delta: -1 | 1): void {
  if (!latestState || activeLane !== "tweets") return
  const groups = visibleTweetGroups(latestState.tweetGroups)
  if (groups.length === 0) return
  const currentIndex = activeSelectionGroupId ? groups.findIndex((group) => group.groupId === activeSelectionGroupId) : -1
  const nextIndex = currentIndex < 0 ? (delta > 0 ? 0 : groups.length - 1) : Math.max(0, Math.min(groups.length - 1, currentIndex + delta))
  activeSelectionGroupId = groups[nextIndex]?.groupId
  render()
  scrollActiveSelectionIntoView()
}

function scrollActiveSelectionIntoView(): void {
  document.querySelector(".feed-card.selected")?.scrollIntoView({ block: "nearest", behavior: "smooth" })
}

async function copySelectedGroupMarkdown(): Promise<void> {
  if (!latestState || activeLane !== "tweets") {
    showToast("Open the tweets lane to copy Markdown.")
    return
  }

  const groups = visibleTweetGroups(latestState.tweetGroups)
  const group = (activeSelectionGroupId ? groups.find((candidate) => candidate.groupId === activeSelectionGroupId) : undefined) ?? groups[0]
  if (!group) {
    showToast("No visible tweet group to copy.")
    return
  }

  activeSelectionGroupId = group.groupId
  try {
    await writeClipboardText(buildTweetGroupMarkdown(group))
    showToast(`Copied ${group.tweets.length} tweet${group.tweets.length === 1 ? "" : "s"} as Markdown.`)
    logFrontend("dev_ui_yank_markdown", { groupId: group.groupId, tweets: group.tweets.length })
  } catch (error) {
    showToast(`Could not copy Markdown: ${error instanceof Error ? error.message : String(error)}`)
  }
  render()
  scrollActiveSelectionIntoView()
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  textarea.remove()
  if (!copied) {
    throw new Error("clipboard API unavailable")
  }
}

function showToast(message: string): void {
  toastElement.textContent = message
  toastElement.hidden = false
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => {
    toastElement.hidden = true
  }, 2800)
}

function handleShortcut(event: KeyboardEvent): void {
  if (isEditable(event.target)) {
    if (event.key === "Escape") searchInput.blur()
    return
  }
  if (helpDialog.open) return
  if (event.altKey || event.ctrlKey || event.metaKey) return

  if (event.key === "Escape") {
    clearProfileFilter("escape")
    return
  }
  if (event.key === "j" || event.key === "J") {
    event.preventDefault()
    moveActiveSelection(1)
    return
  }
  if (event.key === "k" || event.key === "K") {
    event.preventDefault()
    moveActiveSelection(-1)
    return
  }
  if (event.key === "r" || event.key === "R") {
    event.preventDefault()
    void refreshState("keyboard")
    return
  }
  if (event.key === "y" || event.key === "Y") {
    event.preventDefault()
    void copySelectedGroupMarkdown()
    return
  }
  if (event.key === "/") {
    event.preventDefault()
    activeLane = "tweets"
    expandControlsPanel()
    render()
    searchInput.focus()
    return
  }
  if (event.key === "f" || event.key === "F") {
    event.preventDefault()
    if (activeLane !== "tweets") {
      activeLane = "tweets"
      controlsExpanded = true
      render()
    } else {
      toggleControlsPanel()
    }
    return
  }
  if (event.key === "1") {
    setLane("tweets")
    return
  }
  if (event.key === "2") {
    setLane("media")
    return
  }
  if (event.key === "3") {
    setLane("jobs")
    return
  }
  if (event.key === "?") {
    showHelp()
  }
}

function buildHelpDialog(): void {
  helpDialog.replaceChildren(
    el("h2", { text: "Keyboard shortcuts" }),
    el("div", { className: "help-grid" }, [
      shortcut("r", "Refresh state now"),
      shortcut("/", "Focus search/filter"),
      shortcut("f", "Toggle search and filters"),
      shortcut("j", "Move selected tweet group down"),
      shortcut("k", "Move selected tweet group up"),
      shortcut("y", "Copy selected tweet/thread Markdown"),
      shortcut("Esc", "Clear profile filter"),
      shortcut("1", "Open tweets lane"),
      shortcut("2", "Open media lane"),
      shortcut("3", "Open jobs/logs lane"),
      shortcut("?", "Show this help"),
    ]),
    el("form", { attrs: { method: "dialog" } }, [el("button", { className: "tab", text: "Close" }, [], { type: "submit" })]),
  )
}

function showHelp(): void {
  if (typeof helpDialog.showModal === "function") {
    helpDialog.showModal()
  }
}

function shortcut(key: string, description: string): DocumentFragment {
  const fragment = document.createDocumentFragment()
  fragment.append(el("kbd", { text: key }), el("span", { text: description }))
  return fragment
}

function metric(label: string, value: number): HTMLElement {
  return el("div", { className: "metric" }, [el("b", { text: String(value) }), el("span", { text: label })])
}

function pill(text: string): HTMLElement {
  return el("span", { className: "pill", text })
}

function statusPill(status: string): HTMLElement {
  return el("span", { className: `pill status-${status}`, text: status })
}

function pathLine(label: string, value: string | undefined): HTMLElement {
  return el("p", { className: "path", text: `${label}: ${value ?? "none"}` })
}

function renderMediaDetails(media: DevUiMediaView): HTMLElement {
  return el("details", { className: "path-details" }, [
    el("summary", { text: "Media paths" }),
    pathLine("Local", media.localPath),
    pathLine("Remote", media.remoteUrl),
    pathLine("Preview", media.previewImageUrl),
  ])
}

function renderMediaGrid(media: readonly DevUiMediaView[]): Node {
  if (media.length === 0) {
    return document.createTextNode("")
  }

  const visibleMedia = media.slice(0, 4)
  return el("div", { className: `media-grid media-grid-count-${visibleMedia.length}` }, visibleMedia.map(renderMediaTile))
}

function renderMediaTile(media: DevUiMediaView): HTMLElement {
  const preview = renderMediaPreview(media)
  const motionMedia = media.type === "gif" || isVideoMedia(media)
  const className = motionMedia ? "media-tile media-tile-video" : "media-tile media-tile-image"
  const badge = motionMedia ? el("span", { className: "media-badge", text: media.type === "gif" ? "GIF" : "Video" }) : document.createTextNode("")
  return el("figure", { className }, [preview ?? renderMediaFallback(media), badge])
}

function renderQuotedTweet(tweet: DevUiTweetView): Node {
  if (!tweet.quotedTweetId && !tweet.quotedTweetUrl) {
    return document.createTextNode("")
  }

  const quoted = tweet.quotedTweet
  if (!quoted) {
    return el("aside", { className: "quote-card quote-card-unresolved" }, [
      el("span", { className: "quote-label", text: "Quoted tweet unavailable" }),
      el("p", { className: "quote-text", text: "This archive has the quote reference but not the quoted tweet body yet." }),
      tweet.quotedTweetId ? el("div", { className: "quote-meta", text: `Tweet ${tweet.quotedTweetId}` }) : document.createTextNode(""),
      tweet.quotedTweetUrl
        ? el("a", { text: tweet.quotedTweetUrl, attrs: { href: tweet.quotedTweetUrl, target: "_blank", rel: "noreferrer" } })
        : document.createTextNode(""),
    ])
  }

  const displayName = quoted.displayName ?? quoted.username ?? quoted.authorId
  const handle = quoted.username ? `@${quoted.username}` : quoted.authorId
  return el("aside", { className: "quote-card quote-card-resolved" }, [
    el("span", { className: "quote-label", text: "Quoted tweet" }),
    el("div", { className: "quote-author" }, [
      el("strong", { text: displayName }),
      el("span", { className: "quote-meta", text: handle }),
      el("span", { className: "quote-meta", text: "·" }),
      el("a", {
        className: "quote-meta",
        text: quoted.createdAt ? formatDate(quoted.createdAt) : "source",
        attrs: { href: quoted.url, target: "_blank", rel: "noreferrer" },
      }),
    ]),
    el("p", { className: "quote-text", text: quoted.text || displayName }),
    renderMediaGrid(quoted.media),
    renderMetrics(quoted),
  ])
}

function renderMetrics(tweet: DevUiTweetView | DevUiQuotedTweetView): HTMLElement {
  const metrics = tweet.publicMetrics
  return el("div", { className: "tweet-metrics" }, [
    el("span", { text: `Replies ${metrics?.replies ?? 0}` }),
    el("span", { text: `Reposts ${metrics?.reposts ?? 0}` }),
    el("span", { text: `Likes ${metrics?.likes ?? 0}` }),
    el("span", { text: `Quotes ${metrics?.quotes ?? 0}` }),
    el("span", { text: `Views ${metrics?.views ?? 0}` }),
  ])
}

function renderAnnotationActions(tweet: DevUiTweetView): HTMLElement {
  const annotation = tweet.annotation
  const noteButton = el("button", { className: "annotation-button", text: annotation.note ? "Edit local note" : "Add local note" }, [], {
    type: "button",
  })
  noteButton.addEventListener("click", () => {
    const note = window.prompt("Local archive note for this tweet", annotation.note ?? "")
    if (note === null) return
    void saveTweetNote(tweet.id, note)
  })

  const bookmarkButton = el(
    "button",
    { className: annotation.bookmarked ? "annotation-button active" : "annotation-button", text: "Local bookmark" },
    [],
    { type: "button" },
  )
  bookmarkButton.addEventListener("click", () => {
    void saveTweetAttribute(tweet.id, "bookmark", !annotation.bookmarked)
  })

  const attributeButton = el(
    "button",
    { className: annotation.attributed ? "annotation-button active" : "annotation-button", text: "Archive attribute" },
    [],
    { type: "button" },
  )
  attributeButton.addEventListener("click", () => {
    void saveTweetAttribute(tweet.id, "attribute", !annotation.attributed)
  })

  const children: Node[] = [noteButton, bookmarkButton, attributeButton]
  if (annotation.note) {
    children.push(el("span", { className: "local-note", text: annotation.note }))
  }
  return el("div", { className: "tweet-actions" }, children)
}

function renderMediaPreview(media: DevUiMediaView): HTMLElement | undefined {
  if (!media.previewUrl) {
    return undefined
  }
  if (isVideoMedia(media)) {
    return el("video", { className: "media-preview media-preview-video", attrs: { src: media.previewUrl, controls: "", preload: "metadata" } })
  }
  if (media.type === "image" || media.type === "gif") {
    return el("img", { className: "media-preview media-preview-image", attrs: { src: media.previewUrl, alt: media.altText ?? `${media.type} media` } })
  }
  return undefined
}

function renderMediaFallback(media: DevUiMediaView): HTMLElement {
  const href = media.remoteUrl ?? media.previewImageUrl
  const label = href ? "Open media" : media.id
  if (href) {
    return el("a", { className: "media-fallback", text: label, attrs: { href, target: "_blank", rel: "noreferrer" } })
  }
  return el("span", { className: "media-fallback", text: label })
}

function isVideoMedia(media: DevUiMediaView): boolean {
  if (media.type === "video") {
    return true
  }
  return /\.(mp4|mov|webm)$/i.test(media.localPath ?? media.previewUrl ?? "")
}

async function saveTweetNote(tweetId: string, note: string): Promise<void> {
  await postAnnotation("/api/tweet-notes", { tweetId, note })
}

async function saveTweetAttribute(tweetId: string, attribute: DevUiTweetAttributeName, value: boolean): Promise<void> {
  await postAnnotation("/api/tweet-attributes", { tweetId, attribute, value })
}

async function postAnnotation(path: string, payload: unknown): Promise<void> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    await refreshState("annotation_saved")
  } catch (error) {
    lastError = `Could not save local annotation: ${error instanceof Error ? error.message : String(error)}`
    render()
  }
}

function emptyState(message: string): HTMLElement {
  return el("div", { className: "empty", text: message })
}

function visibleTweetGroups(groups: readonly DevUiTweetGroupView[]): DevUiTweetGroupView[] {
  return groups.filter(groupMatchesProfile).filter(groupMatchesFilter).filter(groupMatchesTime).filter(groupMatchesTweetFilters).sort(compareTweetGroups)
}

function groupMatchesProfile(group: DevUiTweetGroupView): boolean {
  if (!activeProfileId) return true
  return group.tweets.some((tweet) => tweet.authorId === activeProfileId)
}

function userForTweet(tweet: DevUiTweetView): DevUiUserView | undefined {
  return latestState?.users.find((user) => user.id === tweet.authorId)
}

function profileSummaryFor(userId: string, groups: readonly DevUiTweetGroupView[]): ProfileSummary | undefined {
  const user = latestState?.users.find((candidate) => candidate.id === userId)
  if (user) {
    return profileSummaryFromUser(user)
  }

  let tweetCount = 0
  let latestTweetAt: string | undefined
  let firstTweet: DevUiTweetView | undefined
  for (const group of groups) {
    for (const tweet of group.tweets) {
      if (tweet.authorId !== userId) continue
      firstTweet ??= tweet
      tweetCount += 1
      latestTweetAt = maxText(latestTweetAt, tweet.createdAt ?? tweet.capturedAt)
    }
  }

  if (!firstTweet) {
    return undefined
  }
  return {
    id: userId,
    username: firstTweet.username,
    tweetCount,
    latestTweetAt,
  }
}

function profileSummaryFromUser(user: DevUiUserView): ProfileSummary {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    description: user.description,
    tweetCount: user.tweetCount,
    latestTweetAt: user.latestTweetAt,
  }
}

function profileLabel(profile: ProfileSummary): string {
  return profile.displayName ?? (profile.username ? `@${profile.username}` : profile.id)
}

function groupMatchesFilter(group: DevUiTweetGroupView): boolean {
  if (!filterText) return true
  return group.tweets.some((tweet) => tweetMatchesFilter(tweet)) || group.groupId.toLocaleLowerCase().includes(filterText)
}

function tweetMatchesFilter(tweet: DevUiTweetView): boolean {
  return includesFilter(
    tweet.text,
    tweet.username,
    tweet.id,
    tweet.authorId,
    tweet.url,
    tweet.annotation.note,
    tweet.media.map((media) => [media.localPath, media.remoteUrl, media.previewUrl, media.altText].filter(Boolean).join(" ")).join(" "),
    tweet.quotedTweetId,
    tweet.quotedTweetUrl,
    tweet.quotedTweet?.text,
    tweet.quotedTweet?.username,
    tweet.quotedTweet?.displayName,
    tweet.quotedTweet?.url,
  )
}

function groupMatchesTime(group: DevUiTweetGroupView): boolean {
  const sinceMs = sinceFilterMs()
  const untilMs = untilFilterMs()
  if (sinceMs === undefined && untilMs === undefined) return true
  return group.tweets.some((tweet) => {
    const time = tweetTimeMs(tweet)
    if (time === undefined) return false
    if (sinceMs !== undefined && time < sinceMs) return false
    return untilMs === undefined || time <= untilMs
  })
}

function groupMatchesTweetFilters(group: DevUiTweetGroupView): boolean {
  if (activeTweetFilters.size === 0) return true
  for (const filter of activeTweetFilters) {
    if (!groupHasTweetFilter(group, filter)) return false
  }
  return true
}

function groupHasTweetFilter(group: DevUiTweetGroupView, filter: TweetFilterKey): boolean {
  if (filter === "media") return group.tweets.some((tweet) => tweet.media.length > 0)
  if (filter === "quotes") return group.tweets.some((tweet) => Boolean(tweet.quotedTweetId || tweet.quotedTweetUrl || tweet.quotedTweet))
  if (filter === "replies") return group.kind === "reply" || group.tweets.some((tweet) => Boolean(tweet.inReplyToTweetId))
  if (filter === "localNotes") return group.tweets.some((tweet) => Boolean(tweet.annotation.note))
  if (filter === "bookmarks") return group.tweets.some((tweet) => tweet.annotation.bookmarked)
  return group.tweets.some((tweet) => tweet.annotation.attributed)
}

function compareTweetGroups(left: DevUiTweetGroupView, right: DevUiTweetGroupView): number {
  if (tweetSortMode === "latest") {
    return displayTimeMs(right.latestAt) - displayTimeMs(left.latestAt)
  }
  const metric = tweetSortMode as TweetMetricSortMode
  const byMetric = groupMetric(right, metric) - groupMetric(left, metric)
  return byMetric === 0 ? displayTimeMs(right.latestAt) - displayTimeMs(left.latestAt) : byMetric
}

function groupMetric(group: DevUiTweetGroupView, metric: TweetMetricSortMode): number {
  return group.tweets.reduce((sum, tweet) => sum + (tweet.publicMetrics?.[metric] ?? 0), 0)
}

function tweetTimeMs(tweet: DevUiTweetView): number | undefined {
  const ms = displayTimeMs(tweet.createdAt ?? tweet.capturedAt)
  return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

function sinceFilterMs(): number | undefined {
  if (!sinceFilter) return undefined
  const ms = new Date(`${sinceFilter}T00:00:00`).valueOf()
  return Number.isNaN(ms) ? undefined : ms
}

function untilFilterMs(): number | undefined {
  if (!untilFilter) return undefined
  const ms = new Date(`${untilFilter}T23:59:59.999`).valueOf()
  return Number.isNaN(ms) ? undefined : ms
}

function mediaMatchesFilter(media: DevUiMediaView): boolean {
  return includesFilter(media.id, media.tweetId, media.type, media.remoteUrl, media.localPath, media.previewUrl, media.downloadStatus)
}

function jobMatchesFilter(job: SqliteCaptureJob): boolean {
  return includesFilter(job.id, job.source, job.target, job.status, job.stage, job.error)
}

function eventMatchesFilter(event: DevUiLogEventView): boolean {
  return includesFilter(
    event.component,
    event.event,
    event.level,
    event.jobId,
    event.runId,
    event.raw,
    event.parseError,
    event.details ? JSON.stringify(event.details) : undefined,
  )
}

function includesFilter(...values: ReadonlyArray<string | undefined>): boolean {
  if (!filterText) return true
  return values.some((value) => value?.toLocaleLowerCase().includes(filterText) ?? false)
}

function maxText(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) return right
  if (!right) return left
  return left.localeCompare(right) >= 0 ? left : right
}

function displayTimeMs(value: string | undefined): number {
  if (!value) return 0
  const ms = new Date(value).valueOf()
  return Number.isNaN(ms) ? 0 : ms
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) {
    return value
  }
  return date.toLocaleString()
}

function logFrontend(event: string, details: FrontendLogDetails = {}): void {
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, details }),
  }).catch(() => undefined)
}

function el<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  options: { readonly className?: string; readonly text?: string; readonly attrs?: Readonly<Record<string, string>> } = {},
  children: readonly Node[] = [],
  properties: { readonly type?: "button" | "submit" | "reset"; readonly title?: string } = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)
  if (options.className) element.className = options.className
  if (options.text !== undefined) element.textContent = options.text
  if (properties.type && element instanceof HTMLButtonElement) element.type = properties.type
  if (properties.title) element.title = properties.title
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      element.setAttribute(name, value)
    }
  }
  element.append(...children)
  return element
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("button, a, input, select, textarea, label"))
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!element) {
    throw new Error(`Missing #${id}`)
  }
  return element
}
