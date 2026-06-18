import { createSignal, onMount } from 'solid-js';
import { clearClipStore, getClip, listClips, type ClipSummary } from '../lib/clip-store';
import { clearDebugLogs, listDebugLogs, type DebugLogEntry } from '../lib/dev-log';
import type { TtsGenerateMessage } from '../lib/messages';
import { nextRequestId } from '../lib/request-id';

const SAMPLE_TEXT =
  '白日依山尽，黄河入海流。欲穷千里目，更上一层楼。你可以在这个设置页面直接测试语音生成。';

export function App() {
  const [status, setStatus] = createSignal('Idle');
  const [text, setText] = createSignal(SAMPLE_TEXT);
  const [clips, setClips] = createSignal<ClipSummary[]>([]);
  const [logs, setLogs] = createSignal<DebugLogEntry[]>([]);
  const [activeRequestId, setActiveRequestId] = createSignal<string | null>(null);
  const audioCtx = new AudioContext();

  function previewText(value: string, limit = 18): string {
    if (value.length <= limit) {
      return value;
    }
    return `${value.slice(0, limit)}...`;
  }

  function formatTime(ms: number): string {
    const sec = Math.max(0, Math.round(ms / 1000));
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${min}:${rem.toString().padStart(2, '0')}`;
  }

  async function refreshClips(): Promise<void> {
    const rows = await listClips();
    setClips(rows);
  }

  async function refreshLogs(): Promise<void> {
    const rows = await listDebugLogs();
    setLogs(rows.slice(-120).reverse());
  }

  async function waitForClip(requestId: string): Promise<ClipSummary | null> {
    for (let i = 0; i < 50; i += 1) {
      const rows = await listClips();
      const found = rows.find((clip) => clip.requestId === requestId) ?? null;
      if (found) {
        setClips(rows);
        return found;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  }

  async function generateFromSettings(): Promise<void> {
    const value = text().trim();
    if (!value) {
      setStatus('Enter text first.');
      return;
    }

    const requestId = nextRequestId('settings');
    setActiveRequestId(requestId);
    setStatus(`Queued ${requestId}`);

    const message: TtsGenerateMessage = {
      type: 'tts.generate',
      requestId,
      text: value,
      language: 'zh'
    };

    await chrome.runtime.sendMessage(message);
    const clip = await waitForClip(requestId);
    if (clip) {
      setStatus(`Done ${requestId} (${clip.id.slice(0, 8)})`);
    } else {
      setStatus(`No clip yet for ${requestId}. Check logs below.`);
    }
    await refreshLogs();
  }

  async function playClip(clipId: string): Promise<void> {
    const clip = await getClip(clipId);
    if (!clip) {
      setStatus('Clip not found');
      return;
    }
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    const buffer = audioCtx.createBuffer(1, clip.pcm.length, clip.sampleRate);
    buffer.copyToChannel(Float32Array.from(clip.pcm), 0);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start();
    setStatus(`Playing ${clip.id.slice(0, 8)}`);
  }

  async function resetDb(): Promise<void> {
    await clearClipStore();
    setClips([]);
    setStatus('Local SQLite clip DB cleared.');
  }

  async function clearLogs(): Promise<void> {
    await clearDebugLogs();
    setLogs([]);
    setStatus('In-extension debug logs cleared.');
  }

  onMount(() => {
    void refreshClips();
    void refreshLogs();
  });

  return (
    <main>
      <h1>Illiterati Settings</h1>
      <p>
        Use this page when page overlays do not appear. It sends `tts.generate` directly, then verifies clip
        persistence.
      </p>

      <label class="label" for="sample-text">
        Example Chinese text
      </label>
      <textarea
        id="sample-text"
        value={text()}
        onInput={(event) => setText(event.currentTarget.value)}
        rows={5}
      />

      <div class="actions">
        <button onClick={() => void generateFromSettings()}>Generate Test Audio</button>
        <button onClick={() => void refreshClips()}>Refresh Clips</button>
        <button onClick={() => void resetDb()}>Reset Local DB</button>
        <button onClick={() => void refreshLogs()}>Refresh Logs</button>
        <button onClick={() => void clearLogs()}>Clear Logs</button>
      </div>

      <div id="status">
        {status()}
        {activeRequestId() ? ` | request=${activeRequestId()}` : ''}
      </div>

      <h2>Saved Clips</h2>
      <table class="clip-table">
        <thead>
          <tr>
            <th>Clip</th>
            <th>Text</th>
            <th>Duration</th>
            <th>Model</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {clips().map((clip) => (
            <tr>
              <td title={clip.id}>{clip.id.slice(0, 8)}</td>
              <td title={clip.text}>{previewText(clip.text)}</td>
              <td>{formatTime(clip.durationMs)}</td>
              <td>{clip.model}</td>
              <td>
                <button class="mini" onClick={() => void playClip(clip.id)}>
                  Play
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Debug Logs</h2>
      <p class="hint">
        Also available in Chrome DevTools: page console, extension service worker, and popup inspect view.
      </p>
      <div id="logs">
        {logs().map((log) => (
          <div class="log-row">
            <code>
              [{log.ts}] [{log.scope}] {log.message}
            </code>
            <code>{log.meta ? JSON.stringify(log.meta) : ''}</code>
          </div>
        ))}
      </div>
    </main>
  );
}
