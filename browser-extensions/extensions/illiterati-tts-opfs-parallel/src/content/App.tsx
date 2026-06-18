import { createSignal, onCleanup } from 'solid-js';
import type { ExtensionMessage, TtsGenerateMessage } from '../lib/messages';
import { devLog } from '../lib/dev-log';

export function App() {
  const [status, setStatus] = createSignal('Idle');

  let activeRequestId: string | null = null;
  let audioTime = 0;
  const audioCtx = new AudioContext();

  function getSelectionText(): string {
    return window.getSelection()?.toString().trim() ?? '';
  }

  function queueMockAudio(chunk: number[]): void {
    const sampleRate = audioCtx.sampleRate;
    const frameCount = chunk.length;
    const buffer = audioCtx.createBuffer(1, frameCount, sampleRate);
    buffer.copyToChannel(Float32Array.from(chunk), 0);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(audioCtx.currentTime + audioTime);
    audioTime += frameCount / sampleRate;
  }

  function startGeneration(text: string): void {
    const requestId = crypto.randomUUID();
    activeRequestId = requestId;
    audioTime = 0;

    const message: TtsGenerateMessage = {
      type: 'tts.generate',
      requestId,
      text,
      language: 'zh'
    };

    setStatus(`Queued: ${text.slice(0, 60)}`);
    devLog('content', 'Sending tts.generate', { requestId, textLength: text.length });
    chrome.runtime.sendMessage(message).catch(() => setStatus('Failed to send request'));
  }

  async function onPlay(): Promise<void> {
    const text = getSelectionText();
    if (!text) {
      setStatus('Select text first.');
      return;
    }

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    startGeneration(text);
  }

  const onMessage = (message: ExtensionMessage | { type: 'illiterati.context-menu' }) => {
    if (!activeRequestId || (message as { requestId?: string }).requestId !== activeRequestId) {
      if (message.type === 'illiterati.context-menu') {
        const text = getSelectionText();
        if (text) {
          startGeneration(text);
        } else {
          setStatus('Context menu used without selection.');
        }
      }
      return;
    }

    if (message.type === 'tts.progress') {
      devLog('content', 'Received tts.progress', {
        requestId: message.requestId,
        progress: message.progress
      });
      setStatus(`Progress ${Math.round(message.progress * 100)}% (${message.stage})`);
      return;
    }

    if (message.type === 'tts.stream') {
      devLog('content', 'Received tts.stream', {
        requestId: message.requestId,
        chunkIndex: message.chunkIndex
      });
      queueMockAudio(message.pcm);
      const last = message.alignment.at(-1);
      const highlightHint = typeof last?.charIndex === 'number' ? ` up to char ${last.charIndex}` : '';
      setStatus(`Streaming chunk ${message.chunkIndex}${highlightHint}`);
      return;
    }

    if (message.type === 'tts.done') {
      devLog('content', 'Received tts.done', { requestId: message.requestId });
      const details = [message.clipId, message.model].filter(Boolean).join(' / ');
      setStatus(details ? `Done (${details})` : 'Done');
      activeRequestId = null;
      audioTime = 0;
      return;
    }

    if (message.type === 'tts.error') {
      devLog('content', 'Received tts.error', {
        requestId: message.requestId,
        code: message.code
      });
      setStatus(`Error (${message.code}): ${message.message}`);
      activeRequestId = null;
      audioTime = 0;
    }
  };

  chrome.runtime.onMessage.addListener(onMessage);
  onCleanup(() => {
    chrome.runtime.onMessage.removeListener(onMessage);
  });

  return (
    <div id="illiterati-overlay">
      <button id="illiterati-play" onClick={onPlay}>
        Read selection
      </button>
      <div id="illiterati-status">{status()}</div>
    </div>
  );
}
