import type {
  ExtensionMessage,
  TtsDoneMessage,
  TtsErrorMessage,
  TtsGenerateMessage,
  TtsProgressMessage,
  TtsStreamMessage
} from '../lib/messages';
import { devLog } from '../lib/dev-log';
import { saveClip } from '../lib/clip-store';
import { MODEL_NAME } from '../lib/build-info';

const OFFSCREEN_PATH = 'offscreen.html';
const REQUEST_TO_TAB = new Map<string, number>();
const REQUEST_DATA = new Map<string, { text: string; language: string; pcm: number[] }>();

async function hasOffscreenDocument(path: string): Promise<boolean> {
  const offscreenUrl = chrome.runtime.getURL(path);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [offscreenUrl]
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreenDocument(OFFSCREEN_PATH)) {
    devLog('background', 'Offscreen document already running');
    return;
  }

  devLog('background', 'Creating offscreen document');
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Run long-lived local TTS and stream audio chunks.'
  });
}

function relayToTab(requestId: string, payload: ExtensionMessage): void {
  const tabId = REQUEST_TO_TAB.get(requestId);
  if (typeof tabId !== 'number') {
    devLog('background', 'No tab mapped for request, dropping message', { requestId, type: payload.type });
    return;
  }
  chrome.tabs.sendMessage(tabId, payload).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener(() => {
  devLog('background', 'Extension installed, creating context menu');
  chrome.contextMenus.create({
    id: 'illiterati-read-selection',
    title: 'Read selection with Illiterati',
    contexts: ['selection']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'illiterati-read-selection' || !tab?.id) {
    return;
  }
  chrome.tabs
    .sendMessage(tab.id, { type: 'illiterati.context-menu' })
    .catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === 'tts.generate') {
    const generate = message as TtsGenerateMessage;
    const tabId = sender.tab?.id;
    devLog('background', 'Received tts.generate', {
      requestId: generate.requestId,
      textLength: generate.text.length,
      tabId
    });

    if (typeof tabId === 'number') {
      REQUEST_TO_TAB.set(generate.requestId, tabId);
    }
    REQUEST_DATA.set(generate.requestId, {
      text: generate.text,
      language: generate.language ?? 'zh',
      pcm: []
    });

    (async () => {
      await ensureOffscreen();
      chrome.runtime
        .sendMessage({
          ...generate,
          source: 'background'
        })
        .catch(() => undefined);
    })();
    return;
  }

  if (message.type === 'tts.progress') {
    const progress = message as TtsProgressMessage;
    devLog('background', 'Relaying tts.progress', { requestId: progress.requestId, progress: progress.progress });
    relayToTab(progress.requestId, progress);
    return;
  }

  if (message.type === 'tts.stream') {
    const stream = message as TtsStreamMessage;
    const data = REQUEST_DATA.get(stream.requestId);
    if (data) {
      data.pcm.push(...stream.pcm);
    }
    devLog('background', 'Relaying tts.stream', {
      requestId: stream.requestId,
      chunkIndex: stream.chunkIndex,
      pcmLength: stream.pcm.length
    });
    relayToTab(stream.requestId, stream);
    return;
  }

  if (message.type === 'tts.done') {
    const done = message as TtsDoneMessage;
    void (async () => {
      let clipId = done.clipId;
      const data = REQUEST_DATA.get(done.requestId);
      if (data && data.pcm.length > 0) {
        try {
          const saved = await saveClip({
            id: crypto.randomUUID(),
            requestId: done.requestId,
            text: data.text,
            language: data.language,
            model: done.model ?? MODEL_NAME,
            codeVersion: done.codeVersion ?? 'unknown',
            sampleRate: 24_000,
            pcm: Float32Array.from(data.pcm)
          });
          clipId = saved.id;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          clipId = `error:${message.slice(0, 60)}`;
        }
      }

      const enrichedDone: TtsDoneMessage = {
        ...done,
        clipId
      };

      devLog('background', `Relaying tts.done request=${done.requestId} clipId=${String(clipId)}`);
      relayToTab(done.requestId, enrichedDone);
      REQUEST_TO_TAB.delete(done.requestId);
      REQUEST_DATA.delete(done.requestId);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === 'tts.error') {
    const error = message as TtsErrorMessage;
    devLog('background', 'Relaying tts.error', { requestId: error.requestId, code: error.code });
    relayToTab(error.requestId, error);
    REQUEST_TO_TAB.delete(error.requestId);
    REQUEST_DATA.delete(error.requestId);
  }
});
