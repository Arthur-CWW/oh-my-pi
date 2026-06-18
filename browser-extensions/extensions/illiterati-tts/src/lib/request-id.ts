let requestCounter = 0;

export function nextRequestId(prefix = 'req'): string {
  requestCounter += 1;
  return `${prefix}-${Date.now()}-${requestCounter.toString().padStart(4, '0')}`;
}
