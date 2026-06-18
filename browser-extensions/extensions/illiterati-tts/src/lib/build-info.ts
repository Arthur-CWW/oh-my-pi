declare const __ILLITERATI_COMMIT__: string | undefined;

export const MODEL_NAME = 'Qwen3-TTS-0.6B';

export function getCodeVersion(): string {
  const version = chrome.runtime.getManifest().version;
  if (typeof __ILLITERATI_COMMIT__ === 'string' && __ILLITERATI_COMMIT__) {
    return `${version}+${__ILLITERATI_COMMIT__}`;
  }
  return `${version}+unknown`;
}
