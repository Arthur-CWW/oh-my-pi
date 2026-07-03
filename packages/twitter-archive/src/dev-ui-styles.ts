export const DEV_UI_STYLES = String.raw`
:root {
  color-scheme: dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #000;
  color: #e7e9ea;
}

* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: #000; }
button, input, select { font: inherit; }
button { color: inherit; }

.app-shell { min-height: 100vh; display: grid; grid-template-rows: auto 1fr; }
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  gap: 0.4rem;
  align-items: center;
  width: min(100%, 38rem);
  margin: 0 auto;
  padding: 0.38rem 0.75rem;
  border-right: 1px solid #2f3336;
  border-bottom: 1px solid #2f3336;
  border-left: 1px solid #2f3336;
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(18px);
}
.brand { min-width: 0; flex: 1; }
.brand h1 { margin: 0; font-size: 1rem; line-height: 1.2; letter-spacing: -0.01em; }
.brand p { display: none; }
.shortcut { color: #71767b; font-size: 0.75rem; white-space: nowrap; }
.tabs { display: flex; gap: 0.3rem; align-items: center; }
.tab,
.controls-toggle,
.annotation-button {
  border: 1px solid #2f3336;
  border-radius: 999px;
  color: #e7e9ea;
  background: #000;
  cursor: pointer;
}
.tab { padding: 0.42rem 0.62rem; }
.tab[aria-selected="true"] { color: #fff; background: #1d9bf0; border-color: #1d9bf0; }
.controls-toggle { white-space: nowrap; }
.controls-toggle[aria-expanded="true"] { color: #fff; border-color: #1d9bf0; background: rgba(29, 155, 240, 0.18); }

.lane-grid { width: min(100%, 38rem); display: grid; grid-template-columns: minmax(0, 1fr); margin: 0 auto; }
.lane { min-width: 0; min-height: 100vh; border-right: 1px solid #2f3336; border-left: 1px solid #2f3336; background: #000; }
.lane-header {
  position: sticky;
  top: 2.78rem;
  z-index: 6;
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: center;
  min-height: 3.15rem;
  padding: 0.55rem 1rem;
  border-bottom: 1px solid #2f3336;
  background: rgba(0, 0, 0, 0.86);
  backdrop-filter: blur(18px);
}
.lane-header h2 { margin: 0; font-size: 1.05rem; line-height: 1.18; }
.lane-header p { margin: 0.08rem 0 0; color: #71767b; font-size: 0.76rem; line-height: 1.25; }

.controls-panel {
  position: sticky;
  top: 5.93rem;
  z-index: 5;
  display: grid;
  grid-template-columns: minmax(10rem, 1fr) repeat(3, minmax(5rem, 0.55fr));
  gap: 0.45rem;
  padding: 0.55rem 1rem;
  border-bottom: 1px solid #2f3336;
  background: rgba(0, 0, 0, 0.94);
  backdrop-filter: blur(18px);
}
.controls-panel[hidden] { display: none; }
.control-field { display: grid; gap: 0.22rem; color: #71767b; font-size: 0.76rem; }
.control-field input,
.control-field select {
  width: 100%;
  border: 1px solid #2f3336;
  border-radius: 0.55rem;
  background: #16181c;
  color: #e7e9ea;
  padding: 0.42rem 0.55rem;
  outline: none;
}
.control-field input:focus,
.control-field select:focus { border-color: #1d9bf0; box-shadow: 0 0 0 2px rgba(29, 155, 240, 0.18); }
.search-field { grid-column: 1 / -1; }
.filter-chips { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 0.38rem; }
.filter-chip {
  display: inline-flex;
  gap: 0.32rem;
  align-items: center;
  border: 1px solid #2f3336;
  border-radius: 999px;
  padding: 0.25rem 0.5rem;
  color: #cfd9de;
  background: #000;
  font-size: 0.76rem;
  cursor: pointer;
}
.filter-chip:has(input:checked) { color: #fff; border-color: #1d9bf0; background: rgba(29, 155, 240, 0.18); }

.summary {
  display: flex;
  gap: 0;
  overflow-x: auto;
  border-bottom: 1px solid #2f3336;
  scrollbar-width: thin;
}
.metric { min-width: 6.75rem; padding: 0.48rem 0.75rem; border-right: 1px solid #2f3336; background: #000; }
.metric:last-child { border-right: 0; }
.metric b { display: block; font-size: 0.96rem; line-height: 1.1; }
.metric span { display: block; margin-top: 0.1rem; color: #71767b; font-size: 0.72rem; }

.profile-panel:not(:empty) { display: grid; gap: 0.7rem; padding: 0 1rem 1rem; border-bottom: 1px solid #2f3336; background: #000; }
.profile-cover { height: 7.5rem; margin: 0 -1rem; background: linear-gradient(135deg, #1d9bf0, #536471 62%, #0f1419); }
.profile-panel p { margin: 0; color: #e7e9ea; line-height: 1.45; }
.profile-heading { display: flex; gap: 0.75rem; align-items: end; margin-top: -2.2rem; }
.profile-title { display: grid; gap: 0.05rem; min-width: 0; flex: 1; }
.profile-heading strong { color: #e7e9ea; font-size: 1.1rem; }
.profile-heading span { color: #71767b; }
.profile-avatar { width: 4.4rem; height: 4.4rem; border: 4px solid #000; font-size: 1.55rem; }

.content { display: grid; }
.content > h3 { margin: 1rem 1rem 0; }
.content > .card:not(.feed-card), .content > .empty { margin: 1rem; }
.card { border: 1px solid #2f3336; border-radius: 0.9rem; padding: 0.9rem; background: #000; }
.card h3 { margin: 0 0 0.45rem; font-size: 0.97rem; }
.meta { display: flex; flex-wrap: wrap; gap: 0.45rem; color: #71767b; font-size: 0.78rem; }
.pill { border: 1px solid #2f3336; border-radius: 999px; padding: 0.15rem 0.45rem; color: #cfd9de; background: #000; }

.feed-card { padding: 0; overflow: hidden; border: 0; border-bottom: 1px solid #2f3336; border-radius: 0; }
.feed-card > .group-meta { padding: 0.45rem 1rem 0.35rem 4.2rem; border-bottom: 0; }
.feed-card.selected { background: rgba(29, 155, 240, 0.07); box-shadow: inset 3px 0 0 #1d9bf0; }
.feed-card.selected > .group-meta .pill:first-child { color: #fff; border-color: #1d9bf0; background: rgba(29, 155, 240, 0.2); }
.tweet { padding: 0.62rem 1rem 0.72rem; }
.tweet + .tweet { border-top: 1px solid #2f3336; }
.tweet.reply { box-shadow: inset 2px 0 0 rgba(29, 155, 240, 0.55); }
.feed-row { display: grid; grid-template-columns: 2.5rem minmax(0, 1fr); gap: 0.68rem; }
.avatar { width: 2.35rem; height: 2.35rem; border-radius: 999px; display: grid; place-items: center; overflow: hidden; background: #1d9bf0; color: #fff; font-weight: 700; }
.avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.feed-body { min-width: 0; }
.feed-author { display: flex; min-width: 0; gap: 0.32rem; align-items: baseline; color: #71767b; font-size: 0.9rem; line-height: 1.25; }
.feed-author strong { max-width: 12rem; overflow: hidden; color: #e7e9ea; text-overflow: ellipsis; white-space: nowrap; }
.feed-author span,
.feed-author a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.feed-author a { color: #71767b; text-decoration: none; }
.author-button { display: inline-flex; min-width: 0; gap: 0.32rem; align-items: baseline; border: 0; padding: 0; color: inherit; background: transparent; cursor: pointer; }
.author-button:hover strong,
.author-button:focus-visible strong { text-decoration: underline; }
.retweet-context { margin-bottom: 0.12rem; color: #71767b; font-size: 0.78rem; font-weight: 700; }
.reply-context { margin-top: 0.18rem; color: #71767b; font-size: 0.8rem; }
.reply-context a { color: #1d9bf0; text-decoration: none; }
.tweet p { margin: 0.32rem 0; white-space: pre-wrap; line-height: 1.42; color: #e7e9ea; }

.media-grid { display: grid; gap: 2px; margin-top: 0.55rem; overflow: hidden; border: 1px solid #2f3336; border-radius: 1rem; background: #2f3336; }
.media-grid-count-1 { display: block; background: #0f1419; }
.media-grid-count-2,
.media-grid-count-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.media-grid-count-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.media-grid-count-3 .media-tile:first-child { grid-row: span 2; }
.media-tile { position: relative; min-height: 8.5rem; margin: 0; overflow: hidden; background: #0f1419; }
.media-grid-count-1 .media-tile { min-height: 12rem; max-height: 32rem; }
.media-preview { display: block; width: 100%; height: 100%; min-height: inherit; max-height: 32rem; object-fit: cover; background: #0f1419; }
.media-grid-count-1 .media-preview { height: auto; max-height: 32rem; object-fit: contain; }
.media-preview-video { aspect-ratio: 16 / 9; object-fit: contain; }
.media-badge { position: absolute; right: 0.55rem; bottom: 0.55rem; border-radius: 999px; padding: 0.16rem 0.45rem; color: #fff; background: rgba(0, 0, 0, 0.72); font-size: 0.72rem; }
.media-fallback { display: grid; min-height: inherit; place-items: center; padding: 0.75rem; color: #71767b; text-align: center; overflow-wrap: anywhere; }
.media-card-preview { margin: 0.65rem 0; }
.media-card-preview .media-grid { margin-top: 0; }
.path-details { margin-top: 0.65rem; color: #71767b; font-size: 0.78rem; }
.path-details summary { cursor: pointer; }
.path { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #00ba7c; }

.quote-card { margin-top: 0.55rem; border: 1px solid #2f3336; border-radius: 1rem; padding: 0.65rem; background: #000; color: #cfd9de; overflow: hidden; }
.quote-card strong { color: #e7e9ea; }
.quote-card .quote-label,
.quote-card .quote-meta,
.quote-card .tweet-metrics { color: #71767b; font-size: 0.78rem; }
.quote-card .quote-label { display: block; margin-bottom: 0.32rem; text-transform: uppercase; letter-spacing: 0.04em; }
.quote-card .quote-author { display: flex; min-width: 0; gap: 0.35rem; align-items: baseline; }
.quote-card .quote-text { margin: 0.35rem 0; white-space: pre-wrap; line-height: 1.38; }
.quote-card .media-grid { border-radius: 0.85rem; }
.quote-card .media-tile { min-height: 6.75rem; }
.quote-card a { color: #1d9bf0; overflow-wrap: anywhere; }
.quote-card-resolved { border-style: solid; }
.quote-card-unresolved { border-style: dashed; background: rgba(113, 118, 123, 0.08); }
.quote-card-unresolved .quote-text { color: #71767b; }

.tweet-metrics,
.tweet-actions { display: flex; flex-wrap: wrap; gap: 0.72rem; align-items: center; margin-top: 0.62rem; color: #71767b; font-size: 0.78rem; }
.annotation-button { padding: 0.25rem 0.55rem; color: #cfd9de; }
.annotation-button.active { color: #fff; background: rgba(0, 186, 124, 0.25); border-color: #00ba7c; }
.local-note { min-width: 100%; color: #ffd400; }
.status-downloaded { color: #00ba7c; }
.status-queued { color: #ffd400; }
.status-remote-only { color: #1d9bf0; }
.status-missing-remote { color: #f4212e; }
.empty { color: #71767b; text-align: center; padding: 2rem; border-bottom: 1px solid #2f3336; }
.toast { position: fixed; left: 50%; bottom: 1.25rem; z-index: 20; transform: translateX(-50%); max-width: min(34rem, calc(100vw - 2rem)); border: 1px solid #1d9bf0; border-radius: 999px; padding: 0.65rem 1rem; color: #fff; background: rgba(29, 155, 240, 0.94); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45); }
dialog { width: min(36rem, calc(100vw - 2rem)); border: 1px solid #2f3336; border-radius: 1rem; background: #000; color: #e7e9ea; }
dialog::backdrop { background: rgba(0, 0, 0, 0.66); }
.help-grid { display: grid; grid-template-columns: auto 1fr; gap: 0.5rem 1rem; }
kbd { border: 1px solid #536471; border-bottom-width: 2px; border-radius: 0.35rem; padding: 0.1rem 0.35rem; background: #16181c; }

.reader-controls { position: sticky; top: 5.93rem; z-index: 5; display: grid; gap: 0.55rem; min-width: 0; padding: 0.65rem 1rem; border-bottom: 1px solid #2f3336; background: rgba(0, 0, 0, 0.94); backdrop-filter: blur(18px); }
.reader-controls[hidden] { display: none; }
.reader-builder-island { min-width: 0; }
.reader-builder { display: grid; grid-template-columns: minmax(0, 1fr) minmax(8rem, 0.42fr); gap: 0.48rem; min-width: 0; }
.reader-field { display: grid; gap: 0.3rem; min-width: 0; color: #71767b; font-size: 0.78rem; }
.reader-command-field,
.reader-sort-field { min-width: 0; }
.reader-command-shell { width: 100%; min-width: 0; }
.reader-command-input,
.reader-sort-trigger { display: inline-flex; width: 100%; min-width: 0; min-height: 2.35rem; align-items: center; justify-content: space-between; border: 1px solid #2f3336; border-radius: 0.7rem; padding: 0.5rem 0.65rem; background: #16181c; color: #e7e9ea; outline: none; }
.reader-sort-trigger { cursor: pointer; text-align: left; }
.reader-sort-trigger::after { width: 0.45rem; height: 0.45rem; margin-left: 0.5rem; flex: 0 0 auto; border-right: 1.5px solid #cfd9de; border-bottom: 1.5px solid #cfd9de; content: ""; transform: translateY(-0.12rem) rotate(45deg); }
.reader-command-input::placeholder { color: #8b98a5; opacity: 1; }
.reader-command-input:focus,
.reader-sort-trigger:focus-visible,
.reader-sql:focus { border-color: #1d9bf0; box-shadow: 0 0 0 2px rgba(29, 155, 240, 0.18); }
.reader-command-popover,
.reader-select-content { z-index: 30; width: min(var(--radix-popover-trigger-width, var(--radix-select-trigger-width, 24rem)), calc(100vw - 1.5rem)); overflow: hidden; border: 1px solid #2f3336; border-radius: 0.75rem; background: #0f1419; color: #e7e9ea; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55); }
.reader-command-list,
.reader-select-viewport { max-height: 16rem; overflow-y: auto; padding: 0.28rem; scrollbar-width: thin; }
.reader-command-item,
.reader-select-item { display: flex; width: 100%; min-width: 0; align-items: center; justify-content: space-between; gap: 0.75rem; border-radius: 0.55rem; padding: 0.48rem 0.55rem; color: #cfd9de; outline: none; cursor: pointer; }
.reader-command-item[aria-selected="true"],
.reader-command-item[data-selected="true"],
.reader-select-item[data-highlighted],
.reader-select-item[data-state="checked"] { color: #fff; background: rgba(29, 155, 240, 0.2); }
.reader-command-item-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reader-command-item-hint { flex: 0 0 auto; color: #8b98a5; font-size: 0.72rem; }
.reader-builder-helper { grid-column: 1 / -1; min-width: 0; color: #8b98a5; font-size: 0.76rem; line-height: 1.35; overflow-wrap: anywhere; }
.reader-token-chips { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 0.36rem; min-width: 0; }
.reader-token-chip { display: inline-flex; max-width: 100%; align-items: center; border: 1px solid #1d9bf0; border-radius: 999px; padding: 0.18rem 0.48rem; color: #fff; background: rgba(29, 155, 240, 0.18); font-size: 0.74rem; line-height: 1.35; overflow-wrap: anywhere; }
.reader-token-muted { border-color: #2f3336; color: #cfd9de; background: #16181c; }
.reader-sql { width: 100%; min-height: 12rem; resize: vertical; overflow: auto; scrollbar-width: thin; border: 1px solid #2f3336; border-radius: 0.65rem; padding: 0.6rem 0.75rem; background: #0f1419; color: #e7e9ea; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.86rem; line-height: 1.45; outline: none; }
.reader-presets { display: flex; flex-wrap: wrap; gap: 0.42rem; min-width: 0; }
.reader-preset { border: 1px solid #2f3336; border-radius: 999px; padding: 0.32rem 0.65rem; color: #cfd9de; background: #16181c; font-size: 0.78rem; cursor: pointer; }
.reader-preset:hover,
.reader-preset:focus-visible { border-color: #1d9bf0; color: #fff; outline: none; box-shadow: 0 0 0 2px rgba(29, 155, 240, 0.18); }
.reader-status { color: #71767b; font-size: 0.8rem; }
.reader-status-error { color: #f4212e; }
.reader-card { position: relative; margin: 1rem; border: 1px solid #2f3336; border-radius: 0.9rem; padding: 0.9rem; background: #000; }
.reader-card-index { position: absolute; top: 0.75rem; right: 0.9rem; color: #71767b; font-size: 0.72rem; }
.reader-card-header { display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: baseline; margin-bottom: 0.55rem; padding-right: 2rem; color: #71767b; font-size: 0.82rem; }
.reader-card-header time { color: #e7e9ea; }
.reader-card-header a { color: #1d9bf0; overflow-wrap: anywhere; text-decoration: none; }
.reader-card-header a:hover { text-decoration: underline; }
.reader-metrics { display: flex; flex-wrap: wrap; gap: 0.6rem; margin-bottom: 0.55rem; color: #71767b; font-size: 0.8rem; }
.reader-labels { display: flex; flex-wrap: wrap; gap: 0.38rem; margin-bottom: 0.55rem; }
.reader-labels .pill { color: #ffd400; border-color: #536471; background: rgba(255, 212, 0, 0.08); }
.reader-quote { display: flex; flex-wrap: wrap; gap: 0.45rem; align-items: baseline; margin-bottom: 0.55rem; color: #71767b; font-size: 0.8rem; }
.reader-quote a { color: #1d9bf0; overflow-wrap: anywhere; text-decoration: none; }
.reader-text { margin: 0; white-space: pre-wrap; line-height: 1.45; color: #e7e9ea; }
.reader-extras { display: grid; gap: 0.25rem; margin-top: 0.65rem; padding-top: 0.65rem; border-top: 1px solid #2f3336; color: #71767b; font-size: 0.78rem; }
.reader-extra { display: flex; gap: 0.35rem; overflow-wrap: anywhere; }
.reader-extra span:first-child { color: #71767b; min-width: 6rem; }
.reader-extra span:last-child { color: #cfd9de; }

@media (max-width: 820px) {
  .topbar { width: 100%; padding: 0.36rem 0.55rem; overflow-x: auto; }
  .brand h1 { font-size: 0.96rem; }
  .tab { padding: 0.38rem 0.52rem; }
  .lane { border-right: 0; border-left: 0; }
  .lane-header { top: 2.62rem; padding: 0.5rem 0.85rem; }
  .controls-panel { top: 5.68rem; grid-template-columns: 1fr; padding: 0.55rem 0.85rem; }
  .reader-controls { top: 5.68rem; padding: 0.55rem 0.85rem; }
  .reader-builder { grid-template-columns: 1fr; }
  .reader-sql { min-height: 7.5rem; }
  .reader-card { margin: 0.85rem; padding: 0.75rem; }
  .feed-card > .group-meta { padding-left: 4rem; }
  .tweet { padding-right: 0.85rem; padding-left: 0.85rem; }
  .media-tile { min-height: 7.5rem; }
  .tabs { overflow-x: auto; }
}
`
