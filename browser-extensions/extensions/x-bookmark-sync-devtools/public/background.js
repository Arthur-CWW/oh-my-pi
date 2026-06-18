chrome.runtime.onInstalled.addListener(() => {
  console.info("X Bookmark Sync DevTools installed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ping") {
    sendResponse({ ok: true });
    return true;
  }
  return false;
});
