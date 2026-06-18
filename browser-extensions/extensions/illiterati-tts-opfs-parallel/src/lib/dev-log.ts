export function devLog(scope: string, message: string, meta?: unknown): void {
  const ts = new Date().toISOString();
  if (meta === undefined) {
    console.info(`[illiterati][${ts}][${scope}] ${message}`);
    return;
  }
  console.info(`[illiterati][${ts}][${scope}] ${message}`, meta);
}

