// ==UserScript==
// @name         Twitter Archive Sync
// @namespace    https://arthur.local/twitter-archive
// @version      0.1.3
// @description  Read-only X/Twitter capture for visible tweets/bookmarks/profile cards. Posts normalized data to the local twitter-archive ingest endpoint.
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      127.0.0.1
// @connect      localhost
// ==/UserScript==

(function () {
  'use strict'

  const DEFAULT_ENDPOINT = 'http://127.0.0.1:3420/x-bookmark-sync/ingest'
  const ENDPOINT_KEY = 'twitterArchiveEndpoint'

  function getEndpoint() {
    return GM_getValue(ENDPOINT_KEY, DEFAULT_ENDPOINT)
  }

  function setEndpoint(endpoint) {
    GM_setValue(ENDPOINT_KEY, endpoint)
  }

  function gmRequest(details) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: details.method,
        url: details.url,
        headers: details.headers,
        data: details.data,
        timeout: details.timeout ?? 15000,
        onload: (response) => resolve(response),
        onerror: (error) => reject(error),
        ontimeout: () => reject(new Error('Request timed out')),
      })
    })
  }

  async function pingHealth(options = {}) {
    const response = await gmRequest({
      method: 'GET',
      url: 'http://127.0.0.1:3420/api/health',
      headers: { accept: 'application/json' },
      timeout: 5000,
    })
    const summary = { status: response.status, body: String(response.responseText).slice(0, 300) }
    console.log('[twitter-archive-sync] health', summary)
    if (options.interactive !== false) {
      alert(`twitter-archive health: ${summary.status}\\n${summary.body}`)
    }
    return summary
  }

  function pageKind() {
    const path = location.pathname
    if (path === '/i/bookmarks') return 'bookmarks'
    if (/^\/[A-Za-z0-9_]+\/status\/\d+/.test(path)) return 'status'
    if (/^\/[A-Za-z0-9_]+$/.test(path)) return 'profile'
    if (path === '/search' || path.startsWith('/search?')) return 'search'
    return 'timeline'
  }

  function isVisible(element) {
    if (!(element instanceof HTMLElement)) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
  }

  function firstStatusLink(root) {
    const links = [...root.querySelectorAll('a[href*=\"/status/\"]')]
    for (const link of links) {
      const url = new URL(link.href, location.href)
      const match = url.pathname.match(/^\/(?:i\/web\/)?([A-Za-z0-9_]+)\/status\/(\d+)/)
      if (match) {
        return { link, username: match[1], tweetId: match[2], href: url.href }
      }
    }
    return null
  }

  function collectMediaUrls(root) {
    const urls = new Set()
    for (const image of root.querySelectorAll('img')) {
      const src = image.getAttribute('src') || ''
      if (src.includes('twimg.com/media') || src.includes('pbs.twimg.com/media')) {
        urls.add(src)
      }
    }
    for (const video of root.querySelectorAll('video')) {
      const src = video.getAttribute('src')
      const poster = video.getAttribute('poster')
      if (src) urls.add(src)
      if (poster) urls.add(poster)
      for (const source of video.querySelectorAll('source')) {
        const sourceSrc = source.getAttribute('src')
        if (sourceSrc) urls.add(sourceSrc)
      }
    }
    return [...urls]
  }

  function tweetText(root) {
    const tweetTextNode = root.querySelector('[data-testid="tweetText"]')
    if (tweetTextNode && tweetTextNode.textContent) {
      return tweetTextNode.textContent.trim()
    }
    const text = root.innerText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n')
      .trim()
    return text
  }

  function replyContext(root) {
    const candidates = [...root.querySelectorAll('span, div')]
      .map((node) => node.textContent?.trim() || '')
      .filter((value) => value.startsWith('Replying to @'))
    return candidates[0]
  }

  function extractVisibleTweets() {
    const articles = [...document.querySelectorAll('article')].filter(isVisible)
    const tweetLike = []

    for (const article of articles) {
      const status = firstStatusLink(article)
      if (!status) continue

      const fullText = tweetText(article)
      if (!fullText) continue

      const quotedStatus = [...article.querySelectorAll('a[href*="/status/"]')]
        .map((link) => link.getAttribute('href') || '')
        .filter((href) => href !== status.href)
        .find(Boolean)

      const url = `https://x.com/${status.username}/status/${status.tweetId}`
      tweetLike.push({
        rest_id: status.tweetId,
        id_str: status.tweetId,
        full_text: fullText,
        screen_name: status.username,
        url,
        path: pageKind(),
        reply_context: replyContext(article),
        quoted_status_path: quotedStatus,
        media_urls: collectMediaUrls(article),
      })
    }

    return tweetLike
  }

  function buildSnapshot(tweetLike) {
    const now = new Date().toISOString()
    return {
      source: {
        extension: 'x-bookmark-sync-devtools',
        client: 'violentmonkey-userscript',
        browser: 'firefox',
        lane: 'userscript-dom',
      },
      generatedAt: now,
      incremental: true,
      captures: [
        {
          id: `userscript-${Date.now()}`,
          capturedAt: now,
          request: {
            method: 'DOM',
            url: location.href,
            headers: {},
          },
          response: {
            status: 200,
            statusText: 'DOM_CAPTURE',
            mimeType: 'text/html',
            bodySize: 0,
            encoding: 'utf-8',
            headers: {},
          },
          timing: {
            startedDateTime: now,
            time: 0,
          },
          tags: ['userscript', pageKind(), 'visible-tweets'],
          tweetLike,
          json: {
            pageUrl: location.href,
            pageTitle: document.title,
            pageKind: pageKind(),
            tweetCount: tweetLike.length,
          },
        },
      ],
    }
  }

  async function runNamedAction(action) {
    if (action === 'ping-health') {
      const summary = await pingHealth({ interactive: false })
      return { ok: true, action, summary }
    }
    if (action === 'sync-visible') {
      const summary = await postVisibleTweets({ interactive: false })
      return { ok: true, action, summary }
    }
    throw new Error(`Unknown Twitter archive action: ${action}`)
  }

  function dispatchResult(detail) {
    window.dispatchEvent(new CustomEvent('twitter-archive-sync:result', { detail }))
    window.__twitterArchiveSyncLastResult = detail
  }

  window.addEventListener('twitter-archive-sync:run', (event) => {
    const action = event && event.detail && typeof event.detail.action === 'string' ? event.detail.action : ''
    runNamedAction(action)
      .then((result) => dispatchResult(result))
      .catch((error) =>
        dispatchResult({
          ok: false,
          action,
          error: error instanceof Error ? error.message : String(error),
        }),
      )
  })

  window.addEventListener('keydown', (event) => {
    if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) {
      return
    }
    const key = event.key.toLowerCase()
    if (key === 's') {
      event.preventDefault()
      postVisibleTweets({ interactive: false })
        .then((summary) => dispatchResult({ ok: true, action: 'sync-visible', summary }))
        .catch((error) =>
          dispatchResult({
            ok: false,
            action: 'sync-visible',
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      return
    }
    if (key === 'h') {
      event.preventDefault()
      pingHealth({ interactive: false })
        .then((summary) => dispatchResult({ ok: true, action: 'ping-health', summary }))
        .catch((error) =>
          dispatchResult({
            ok: false,
            action: 'ping-health',
            error: error instanceof Error ? error.message : String(error),
          }),
        )
    }
  })

  async function postVisibleTweets(options = {}) {
    const tweetLike = extractVisibleTweets()
    if (tweetLike.length === 0) {
      if (options.interactive !== false) {
        alert('No visible tweet cards found on this page.')
      }
      return { status: 0, body: 'No visible tweet cards found on this page.', tweetCount: 0 }
    }

    const payload = buildSnapshot(tweetLike)
    const response = await gmRequest({
      method: 'POST',
      url: getEndpoint(),
      headers: {
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      data: JSON.stringify(payload),
      timeout: 30000,
    })

    const summary = { status: response.status, body: String(response.responseText).slice(0, 500), tweetCount: tweetLike.length }
    console.log('[twitter-archive-sync] ingest', summary)
    if (options.interactive !== false) {
      alert(`twitter-archive ingest: ${summary.status}\\n${summary.body}`)
    }
    return summary
  }

  async function setEndpointPrompt() {
    const next = prompt('twitter-archive ingest endpoint', getEndpoint())
    if (!next) return
    setEndpoint(next.trim())
    alert(`Saved endpoint: ${getEndpoint()}`)
  }

  GM_registerMenuCommand('Twitter archive: ping localhost health', () => {
    pingHealth().catch((error) => {
      console.error('[twitter-archive-sync] health failed', error)
      alert(`twitter-archive health failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  })

  GM_registerMenuCommand('Twitter archive: sync visible tweets', () => {
    postVisibleTweets().catch((error) => {
      console.error('[twitter-archive-sync] sync failed', error)
      alert(`twitter-archive sync failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  })

  GM_registerMenuCommand('Twitter archive: set ingest endpoint', () => {
    setEndpointPrompt()
  })
})()
