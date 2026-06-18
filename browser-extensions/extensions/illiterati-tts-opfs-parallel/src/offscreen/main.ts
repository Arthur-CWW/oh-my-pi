import type {
  AlignmentTuple,
  ExtensionMessage,
  TtsDoneMessage,
  TtsErrorMessage,
  TtsGenerateMessage,
  TtsProgressMessage,
  TtsStreamMessage
} from '../lib/messages';
import { devLog } from '../lib/dev-log';
import { MODEL_NAME } from '../lib/build-info';
import { ensureModelArtifacts } from '../lib/model-loader';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockPcmChunk(size: number, toneHz: number): number[] {
  const sampleRate = 24_000;
  const out: number[] = [];
  for (let i = 0; i < size; i += 1) {
    const t = i / sampleRate;
    out.push(Math.sin(2 * Math.PI * toneHz * t) * 0.12);
  }
  return out;
}

function mockAlignment(text: string, chunkIndex: number, chunkChars: number): AlignmentTuple[] {
  const startChar = chunkIndex * chunkChars;
  const endChar = Math.min(text.length, startChar + chunkChars);

  const tuples: AlignmentTuple[] = [];
  for (let i = startChar; i < endChar; i += 1) {
    tuples.push({
      charIndex: i,
      startMs: i * 55,
      endMs: i * 55 + 55
    });
  }
  return tuples;
}

async function runMockTts(msg: TtsGenerateMessage): Promise<void> {
  devLog('offscreen', 'Starting mock TTS request', {
    requestId: msg.requestId,
    textLength: msg.text.length
  });
  const queued: TtsProgressMessage = {
    type: 'tts.progress',
    requestId: msg.requestId,
    stage: 'queued',
    progress: 0.1
  };
  await chrome.runtime.sendMessage(queued);

  const loading: TtsProgressMessage = {
    type: 'tts.progress',
    requestId: msg.requestId,
    stage: 'loading',
    progress: 0.3
  };
  await sleep(200);
  await chrome.runtime.sendMessage(loading);

  try {
    await ensureModelReady(msg.requestId);
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    const failure: TtsErrorMessage = {
      type: 'tts.error',
      requestId: msg.requestId,
      code: /checksum|corrupt/i.test(errMessage) ? 'MODEL_CORRUPT' : 'MODEL_CACHE_ERROR',
      message: errMessage
    };
    devLog('offscreen', 'Model artifact setup failed', {
      requestId: msg.requestId,
      message: errMessage
    });
    await chrome.runtime.sendMessage(failure);
    return;
  }

  const chunks = 6;
  const chunkChars = Math.max(1, Math.ceil(msg.text.length / chunks));

  for (let index = 0; index < chunks; index += 1) {
    await sleep(140);

    const generating: TtsProgressMessage = {
      type: 'tts.progress',
      requestId: msg.requestId,
      stage: 'generating',
      progress: 0.3 + ((index + 1) / chunks) * 0.6
    };
    await chrome.runtime.sendMessage(generating);

    const stream: TtsStreamMessage = {
      type: 'tts.stream',
      requestId: msg.requestId,
      chunkIndex: index,
      pcm: mockPcmChunk(3_000, 300 + index * 40),
      alignment: mockAlignment(msg.text, index, chunkChars)
    };
    devLog('offscreen', 'Generated stream chunk', {
      requestId: msg.requestId,
      chunkIndex: index
    });
    await chrome.runtime.sendMessage(stream);
  }

  const codeVersion = 'unknown';
  const done: TtsDoneMessage = {
    type: 'tts.done',
    requestId: msg.requestId,
    model: MODEL_NAME,
    codeVersion
  };
  devLog('offscreen', 'Completed mock TTS request', { requestId: msg.requestId });
  await chrome.runtime.sendMessage(done);
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type !== 'tts.generate') {
    return;
  }

  runMockTts(message).catch((error) => {
    const errMessage = error instanceof Error ? error.message : String(error);
    devLog('offscreen', 'Mock TTS failed', { requestId: message.requestId, message: errMessage });
    const failure: TtsErrorMessage = {
      type: 'tts.error',
      requestId: message.requestId,
      code: 'RUNTIME_ERROR',
      message: errMessage
    };
    chrome.runtime.sendMessage(failure).catch(() => undefined);
  });
});

let modelReadyPromise: Promise<void> | null = null;

async function ensureModelReady(requestId: string): Promise<void> {
  if (modelReadyPromise) {
    return modelReadyPromise;
  }

  modelReadyPromise = (async () => {
    const report = await ensureModelArtifacts((status) => {
      const progress: TtsProgressMessage = {
        type: 'tts.progress',
        requestId,
        stage: status.state,
        progress: 0.3 + (status.index / status.total) * 0.25
      };
      devLog('offscreen', 'Model cache status', {
        requestId,
        stage: status.state,
        artifact: status.artifact,
        step: `${status.index}/${status.total}`
      });
      chrome.runtime.sendMessage(progress).catch(() => undefined);
    });
    devLog('offscreen', 'Model cache ready', {
      requestId,
      checked: report.checked,
      downloaded: report.downloaded,
      repaired: report.repaired,
      bytes: report.bytes
    });
  })().catch((error) => {
    modelReadyPromise = null;
    throw error;
  });

  return modelReadyPromise;
}
