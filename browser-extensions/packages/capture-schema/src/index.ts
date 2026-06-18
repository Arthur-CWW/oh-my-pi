export type BrowserKind = "chrome" | "chromium" | "helium" | "firefox" | "unknown";

export type CaptureMode =
  | "devtools-panel"
  | "chrome-debugger"
  | "page-hook"
  | "firefox-stream"
  | "local-proxy"
  | "cdp-agent";

export type Header = {
  name: string;
  value: string;
};

export type CapturedRequest = {
  method: string;
  url: string;
  headers?: Header[];
  postData?: string;
  resourceType?: string;
};

export type CapturedResponse = {
  status: number;
  statusText?: string;
  mimeType?: string;
  headers?: Header[];
  bodySize?: number;
  encoding?: string;
  body?: string;
};

export type CaptureSource = {
  extension: string;
  version: string;
  browser?: BrowserKind;
  mode: CaptureMode;
  tabId?: number;
  frameId?: number;
  sessionId?: string;
};

export type ApiCapture = {
  id: string;
  capturedAt: string;
  source: CaptureSource;
  request: CapturedRequest;
  response?: CapturedResponse;
  timing?: {
    startedDateTime?: string;
    durationMs?: number;
  };
  tags?: string[];
  parsed?: unknown;
  notes?: string[];
};

export type Redaction = {
  path: string;
  reason: "cookie" | "auth-header" | "csrf" | "token" | "manual";
};

export type ReplayRecipe = {
  id: string;
  name: string;
  createdAt: string;
  sourceCaptureIds: string[];
  method: string;
  urlTemplate: string;
  headers: Header[];
  bodyTemplate?: string;
  redactions: Redaction[];
  notes?: string[];
};
