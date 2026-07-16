# FireRedASR2S local trial

Date: 2026-07-16  
Host: Apple M4 Max, arm64, 64 GiB RAM, Python 3.10.18 in an isolated uv venv

## Scope and provenance

The trial target was the existing imported Tutu asset:

- Media: `data/primer/reader-media/大耳朵图图-s2e15-伟大的妈妈-b4703d7719/episode.mp4`
- Bilibili source: https://www.bilibili.com/video/BV17Qjg6KEmZ/
- Uploader: 香萍哔哩 (`697215493`)
- Fetch date: 2026-07-16 (recorded in `streams/primer/research/video-pipeline-pilot.md`)
- Duration reported by the pilot: 825.333 s
- Reference only (never passed to ASR): `data/primer/reader-media-inbox/tutu-s2e15-great-mom/episode.ai-zh.srt`

The reference contains 275 cleaned cues / 2,200 Han characters. The subtitle was not supplied to any FireRed command.

## Isolated installation

Everything below is under `local/firered-trial/`; no `hsk-deck` environment was changed.

```bash
cd ~/agents/local/firered-trial
uv venv --python 3.10 .venv
# Repository is local/firered-trial/src
uv pip install --python .venv/bin/python torch torchaudio
uv pip install --python .venv/bin/python \
  transformers==4.51.3 numpy==1.26.1 cn2an==0.5.23 \
  kaldiio==2.18.0 sentencepiece==0.1.99 soundfile==0.12.1 \
  textgrid 'peft>=0.13.2' modelscope huggingface_hub
uv pip install --python .venv/bin/python kaldi-native-fbank
uv pip install --python .venv/bin/python 'setuptools<81'
```

The published `requirements.txt` cannot be installed as-is on this Mac:

```text
uv pip install --python .venv/bin/python -r src/requirements.txt --dry-run

Because torch==2.1.0+cu118 has no wheels with a matching platform tag
(e.g., macosx_26_0_arm64) ... Wheels are available ... linux_x86_64, win_amd64
```

The pinned `kaldi-native-fbank==1.15` is also unavailable for arm64 macOS. The isolated environment uses the available `kaldi-native-fbank==1.22.3` wheel and `setuptools==80.10.2` because `kaldiio==2.18.0` still imports the removed `pkg_resources` shim in newer setuptools. FireRed imports and CLI help succeeded with this compatibility set:

```text
Python 3.10.18
Torch 2.13.0; MPS built=True, available=True
Torchaudio 2.11.0
FireRedAsr2 import: OK
fireredasr2s-cli --help: OK
```
Although PyTorch reports MPS available, this upstream checkout's `use_gpu=True` paths call `.cuda()` / `torch.cuda`; it has no MPS device path. `use_gpu=False` is CPU execution.

## Audio extraction attempt

The required 16 kHz mono PCM extraction command was run against the final asset:

```bash
cd ~/agents/local/firered-trial
/usr/bin/time -p ffmpeg -y \
  -i ../../data/primer/reader-media/大耳朵图图-s2e15-伟大的妈妈-b4703d7719/episode.mp4 \
  -vn -ar 16000 -ac 1 -acodec pcm_s16le -f wav artifacts/tutu-s2e15.wav
```

Observed: `real 2.87 s`, output duration `475.126750 s`, output size `15,204,134` bytes. The MP4 audio stream starts producing AAC decode errors at approximately `00:07:55` (`Invalid data found when processing input`, `Sample rate index ... does not match ...`, and related AAC frame errors), so this final MP4 does not contain a decodable 825.333-second audio track. The earlier pilot had to use an alternate public Bilibili audio representation for alignment; that temporary file was intentionally removed from the inbox.

## Model-size blocker (trial stopped before inference)

FireRedASR2-AED's official Hugging Face model manifest lists `model.pth.tar` at exactly **4,731,558,506 bytes** (4.41 GiB), plus the small config/dictionary files. The host filesystem had **3.0 GiB free before installation and 2.9 GiB after** the isolated venv/dependencies/audio. Therefore the weights cannot be downloaded locally without deleting unrelated user data. The model was not downloaded and no FireRed transcript was fabricated.

The model also has a published input limit of 60 seconds for AED (40 seconds for the LLM variant), so a complete 825-second episode would require chunking even after the storage blocker is removed.

### Five requested sentence-diff rows

These are reference rows selected from the retained Bilibili ai-zh SRT. FireRed output/diff is explicitly unavailable because the 4.41 GiB weight download was blocked before inference:

| Cue/time | Subtitle reference | FireRed output | Diff / CER contribution |
|---|---|---|---|
| 00:00:00.840–00:00:03.440 | 伟大的妈妈 | **not run** | unavailable |
| 00:00:08.260–00:00:11.280 | 小朋友们放学之前还有一件事 | **not run** | unavailable |
| 00:02:10.310–00:02:13.630 | 健康哥哥明天要召开小豆班家长会 | **not run** | unavailable |
| 00:04:59.400–00:05:00.820 | 他是不是经常犯错误 | **not run** | unavailable |
| 00:09:20.620–00:09:22.080 | 我要做个伟大的女人 | **not run** | unavailable |

Consequently, this run has no FireRed CER, FireRed runtime, or FireRed peak-memory number. The only measured trial-stage runtime is the 2.87-second partial audio extraction above; host RAM is 64 GiB. This is a documented blocker, not a quality result.

## Timestamp contract

FireRedASR2-AED's official standalone Python API uses `return_timestamp=True` and emits native token/character spans in **seconds**:

```python
{
  'timestamp': [('你', 0.42, 0.66), ('好', 0.66, 1.10),
                ('世', 1.10, 1.34), ('界', 1.34, 2.039)]
}
```

The all-in-one CLI/system representation uses millisecond objects, e.g.:

```json
{"words":[{"start_ms":540,"end_ms":700,"text":"你"},
          {"start_ms":700,"end_ms":1100,"text":"好"}]}
```

For Mandarin these are native per-character timestamps (not the Primer alignment driver's interpolation fallback). The AED output is timestamp-capable; the LLM example does not emit timestamps.

## Verdict and GPU-box handoff

**Verdict for replacing subtitle dependency:** promising on paper, but **not validated by this local trial**. FireRedASR2-AED has Chinese support and native character timestamps, which is the right interface for no-sub sources such as Xi speeches and dramas without CC. It cannot yet be accepted as a replacement based on this run because weights could not be installed and the supplied final MP4's audio track is corrupt after 475 seconds.

A CUDA GPU box would buy:

1. A supported runtime for the published `torch==2.1.0+cu118` / `torchaudio==2.1.0+cu118` pins (the official requirements target Linux CUDA, not Apple arm64).
2. Enough local disk/RAM to hold the 4.41 GiB AED checkpoint and its runtime files.
3. Practical throughput for 60-second chunking and batch processing. The upstream README reports a **12.7× TensorRT-LLM speedup over the PyTorch baseline on one H20** for AISHELL-1; that benchmark is not this episode and is not claimed as a local measurement.

A future GPU-box lane should first acquire a clean full-length audio representation, chunk at <=60 seconds, run AED with `return_timestamp=True`, and then calculate CER against this SRT plus peak RSS and wall time. No SSH or GPU migration was attempted tonight.

## Sources

- FireRedASR2S README/setup/API/timestamp examples and input limits: https://github.com/FireRedTeam/FireRedASR2S
- Published dependency pins: https://raw.githubusercontent.com/FireRedTeam/FireRedASR2S/main/requirements.txt
- AED model manifest and exact checkpoint size: https://huggingface.co/api/models/FireRedTeam/FireRedASR2-AED/tree/main
- Primer pilot provenance, subtitle counts, asset import, and known alternate-audio workaround: `streams/primer/research/video-pipeline-pilot.md`
