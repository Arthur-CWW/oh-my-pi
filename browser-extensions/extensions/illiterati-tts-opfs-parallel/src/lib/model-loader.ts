import { MODEL_NAME } from './build-info';

export type ModelArtifactSpec = {
  path: string;
  sourcePath: string;
  sha256: string;
};

export type ModelEnsureReport = {
  model: string;
  checked: number;
  downloaded: number;
  repaired: number;
  bytes: number;
};

const MODEL_CACHE_ROOT = 'models';
const MODEL_VERSION = 'mock-qwen3-tts-0.6b-v1';
const MANIFEST_FILENAME = 'manifest.json';

const ARTIFACTS: ModelArtifactSpec[] = [
  {
    path: 'model.index.json',
    sourcePath: 'model/qwen3-tts-0.6b/model.index.json',
    sha256: 'e75be05285930716b5c74bb4a35ddee66c90ce4877c4942d9bdbb7b3789da044'
  },
  {
    path: 'decoder-shard-0001.bin',
    sourcePath: 'model/qwen3-tts-0.6b/decoder-shard-0001.bin',
    sha256: 'ab576e3128ab6c4f48c89f5062d87506955627b27ea5829a6d15d2203bf43348'
  },
  {
    path: 'decoder-shard-0002.bin',
    sourcePath: 'model/qwen3-tts-0.6b/decoder-shard-0002.bin',
    sha256: '55f6e1365e6618f76dbda667ac6e1b3e16ce54bce8ec03ea646cabf1b12e58e2'
  }
];

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes));
  return toHex(new Uint8Array(digest));
}

async function getOrCreateDirectory(parent: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
  const parts = path.split('/').filter(Boolean);
  let current = parent;
  for (const part of parts) {
    current = await current.getDirectoryHandle(part, { create: true });
  }
  return current;
}

async function getModelDirectory(create: boolean): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const modelsDir = await root.getDirectoryHandle(MODEL_CACHE_ROOT, { create });
  return modelsDir.getDirectoryHandle(MODEL_NAME, { create });
}

async function readFileBytes(dir: FileSystemDirectoryHandle, path: string): Promise<Uint8Array | null> {
  const parts = path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) {
    return null;
  }
  let current = dir;
  for (const part of parts) {
    try {
      current = await current.getDirectoryHandle(part);
    } catch {
      return null;
    }
  }

  try {
    const file = await current.getFileHandle(fileName);
    const blob = await file.getFile();
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

async function writeFileBytes(dir: FileSystemDirectoryHandle, path: string, bytes: Uint8Array): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) {
    throw new Error(`Invalid cache path: "${path}"`);
  }
  const parent = parts.length ? await getOrCreateDirectory(dir, parts.join('/')) : dir;
  const file = await parent.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(toArrayBuffer(bytes));
  await writable.close();
}

async function deleteFile(dir: FileSystemDirectoryHandle, path: string): Promise<void> {
  const parts = path.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) {
    return;
  }
  try {
    const parent = parts.length ? await getOrCreateDirectory(dir, parts.join('/')) : dir;
    await parent.removeEntry(fileName);
  } catch {
    // ignore cleanup errors
  }
}

async function verify(bytes: Uint8Array, expectedSha: string): Promise<boolean> {
  return (await sha256(bytes)) === expectedSha;
}

async function downloadArtifact(spec: ModelArtifactSpec): Promise<Uint8Array> {
  const url = chrome.runtime.getURL(spec.sourcePath);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to download ${spec.path}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function ensureModelArtifacts(
  onStatus?: (status: { state: 'verifying' | 'downloading'; artifact: string; index: number; total: number }) => void
): Promise<ModelEnsureReport> {
  const modelDir = await getModelDirectory(true);
  let downloaded = 0;
  let repaired = 0;
  let bytes = 0;

  for (let index = 0; index < ARTIFACTS.length; index += 1) {
    const artifact = ARTIFACTS[index];
    const step = index + 1;

    onStatus?.({ state: 'verifying', artifact: artifact.path, index: step, total: ARTIFACTS.length });
    const cached = await readFileBytes(modelDir, artifact.path);
    if (cached && (await verify(cached, artifact.sha256))) {
      bytes += cached.byteLength;
      continue;
    }

    if (cached) {
      repaired += 1;
      await deleteFile(modelDir, artifact.path);
    }

    onStatus?.({ state: 'downloading', artifact: artifact.path, index: step, total: ARTIFACTS.length });
    const downloadedBytes = await downloadArtifact(artifact);
    if (!(await verify(downloadedBytes, artifact.sha256))) {
      throw new Error(`Checksum mismatch while downloading ${artifact.path}`);
    }
    await writeFileBytes(modelDir, artifact.path, downloadedBytes);
    downloaded += 1;
    bytes += downloadedBytes.byteLength;
  }

  const manifest = {
    model: MODEL_NAME,
    version: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    artifacts: ARTIFACTS.map((item) => ({ path: item.path, sha256: item.sha256 }))
  };
  await writeFileBytes(modelDir, MANIFEST_FILENAME, new TextEncoder().encode(JSON.stringify(manifest, null, 2)));

  return {
    model: MODEL_NAME,
    checked: ARTIFACTS.length,
    downloaded,
    repaired,
    bytes
  };
}
