import { createSignal, onMount } from 'solid-js';
import { clearClipStore, getClip, listClips, type ClipSummary } from '../lib/clip-store';
import { nextRequestId } from '../lib/request-id';

export function App() {
  const [status, setStatus] = createSignal('Idle');
  const [clips, setClips] = createSignal<ClipSummary[]>([]);
  const [filterClause, setFilterClause] = createSignal('');
  const [activeClipId, setActiveClipId] = createSignal<string | null>(null);
  const [analysis, setAnalysis] = createSignal('Select a clip and click Analyze.');
  const audioCtx = new AudioContext();

  function formatTime(ms: number): string {
    const sec = Math.max(0, Math.round(ms / 1000));
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${min}:${rem.toString().padStart(2, '0')}`;
  }

  function previewText(text: string, limit = 14): string {
    if (text.length <= limit) {
      return text;
    }
    return `${text.slice(0, limit)}...`;
  }

  async function refreshClips(): Promise<void> {
    try {
      const all = await listClips(filterClause());
      setClips(all);
      setStatus(all.length ? `Loaded ${all.length} clip(s)` : 'No clips saved yet');
    } catch (error) {
      setStatus(`Failed to load clips: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function playClip(clipId: string): Promise<void> {
    const clip = await getClip(clipId);
    if (!clip) {
      setStatus('Clip no longer exists');
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
    setStatus(`Playing ${clip.id.slice(0, 8)} (${formatTime(Math.round((clip.pcm.length / clip.sampleRate) * 1000))})`);
  }

  async function analyzeClip(clipId: string): Promise<void> {
    const clip = await getClip(clipId);
    if (!clip) {
      setStatus('Clip no longer exists');
      return;
    }

    setActiveClipId(clip.id);
    setAnalysis(
      [
        `Clip ID: ${clip.id}`,
        `Request ID: ${clip.requestId}`,
        `Created: ${new Date(clip.createdAt).toLocaleString()}`,
        `Duration: ${formatTime(Math.round((clip.pcm.length / clip.sampleRate) * 1000))}`,
        `Samples: ${clip.pcm.length.toLocaleString()}`,
        `Chars: ${clip.text.length.toLocaleString()}`,
        `Model: ${clip.model}`,
        `Code Version: ${clip.codeVersion}`,
        `Language: ${clip.language}`,
        `Text: ${clip.text.slice(0, 300)}${clip.text.length > 300 ? '…' : ''}`
      ].join('\n')
    );
    setStatus(`Analyzed ${clip.id.slice(0, 8)}`);
  }

  const warmup = async () => {
    setStatus('Initializing offscreen runtime...');

    try {
      await chrome.runtime.sendMessage({
        type: 'tts.generate',
        requestId: nextRequestId('popup-warmup'),
        text: 'warmup',
        language: 'zh'
      });
      await refreshClips();
      setStatus('Warmup request sent. Select text on page to test.');
    } catch {
      setStatus('Failed to contact background worker.');
    }
  };

  const resetDb = async () => {
    try {
      await clearClipStore();
      setClips([]);
      setActiveClipId(null);
      setAnalysis('Select a clip and click Analyze.');
      setStatus('Local SQLite clip DB cleared.');
    } catch (error) {
      setStatus(`Failed to clear DB: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const openSettings = () => {
    void chrome.runtime.openOptionsPage();
  };

  onMount(() => {
    void refreshClips();
  });

  return (
    <main>
      <h3>Illiterati</h3>
      <p>Selection -&gt; stream -&gt; local clip DB.</p>
      <div class="actions">
        <button onClick={warmup}>Warmup Runtime</button>
        <button onClick={() => void refreshClips()}>Refresh Clips</button>
        <button onClick={() => void resetDb()}>Reset Local DB</button>
        <button onClick={openSettings}>Open Settings</button>
      </div>
      <label class="filter-label">
        SQL WHERE filter (optional)
        <input
          id="filter-clause"
          value={filterClause()}
          onInput={(event) => setFilterClause(event.currentTarget.value)}
          placeholder={`model = 'Qwen3-TTS-0.6B' AND text LIKE '%曹操%'`}
        />
      </label>
      <div id="status">{status()}</div>
      <table class="clip-table">
        <thead>
          <tr>
            <th>Clip</th>
            <th>Duration</th>
            <th>Text</th>
            <th>Chars</th>
            <th>Model</th>
            <th>Code</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {clips().map((clip) => (
            <tr class={activeClipId() === clip.id ? 'active' : ''}>
              <td title={clip.id}>{clip.id.slice(0, 8)}</td>
              <td>{formatTime(clip.durationMs)}</td>
              <td title={clip.text}>{previewText(clip.text)}</td>
              <td>{clip.text.length}</td>
              <td>{clip.model}</td>
              <td title={clip.codeVersion}>{clip.codeVersion}</td>
              <td>
                <button class="mini" onClick={() => void analyzeClip(clip.id)}>
                  Analyze
                </button>
                <button class="mini" onClick={() => void playClip(clip.id)}>
                  Play
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <pre id="analysis">{analysis()}</pre>
    </main>
  );
}
