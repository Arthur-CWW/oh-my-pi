export type TtsGenerateMessage = {
  type: 'tts.generate';
  requestId: string;
  text: string;
  language?: string;
  source?: 'background';
};

export type TtsProgressMessage = {
  type: 'tts.progress';
  requestId: string;
  stage: 'queued' | 'loading' | 'verifying' | 'downloading' | 'generating';
  progress: number;
};

export type AlignmentTuple = {
  charIndex: number;
  startMs: number;
  endMs: number;
};

export type TtsStreamMessage = {
  type: 'tts.stream';
  requestId: string;
  chunkIndex: number;
  pcm: number[];
  alignment: AlignmentTuple[];
};

export type TtsDoneMessage = {
  type: 'tts.done';
  requestId: string;
  clipId?: string;
  model?: string;
  codeVersion?: string;
};

export type TtsErrorMessage = {
  type: 'tts.error';
  requestId: string;
  code: 'MODEL_CACHE_ERROR' | 'MODEL_CORRUPT' | 'RUNTIME_ERROR';
  message: string;
};

export type ExtensionMessage =
  | TtsGenerateMessage
  | TtsProgressMessage
  | TtsStreamMessage
  | TtsDoneMessage
  | TtsErrorMessage;
