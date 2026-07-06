const MAX_CLIENT_ERRORS_PER_SESSION = 20;

let sentClientErrors = 0;

interface ClientErrorPayload {
  message: string;
  stack?: string;
  url?: string;
}

export function reportClientError(message: string, stack?: string): void {
  if (sentClientErrors >= MAX_CLIENT_ERRORS_PER_SESSION) return;
  sentClientErrors += 1;
  const payload: ClientErrorPayload = { message };
  if (stack !== undefined) payload.stack = stack;
  if (typeof window.location.href === "string") payload.url = window.location.href;
  const body = JSON.stringify(payload);
  if (typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon("/api/client-errors", blob)) return;
  }
  void fetch("/api/client-errors", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
}

function messageAndStackFromReason(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    const result: { message: string; stack?: string } = { message: reason.message };
    if (typeof reason.stack === "string") result.stack = reason.stack;
    return result;
  }
  return { message: String(reason) };
}

window.addEventListener("error", (event) => {
  // Filter benign ResizeObserver noise — floods the log with no actionable signal
  if (typeof event.message === "string" && event.message.includes("ResizeObserver loop")) return;
  const message = typeof event.message === "string" && event.message.length > 0 ? event.message : "Unhandled client error";
  const stack = event.error instanceof Error && typeof event.error.stack === "string" ? event.error.stack : undefined;
  reportClientError(message, stack);
});

window.addEventListener("unhandledrejection", (event) => {
  const details = messageAndStackFromReason(event.reason);
  reportClientError(details.message, details.stack);
});
