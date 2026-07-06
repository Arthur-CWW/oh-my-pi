const READER_ORIGIN = "http://meltdown.localhost:1355"

/**
 * Deep-link for a reader-substrate evidence ref. `reader:annotations:<id>`
 * anchors to the annotation inside the Talmudic reader; any other `reader:*`
 * ref opens the reader root. Non-reader refs (which already carry `hit.url`)
 * return null so callers fall back to the hit's own url.
 */
export function readerRefUrl(ref: string): string | null {
  if (!ref.startsWith("reader:")) return null
  const annotation = /^reader:annotations:(.+)$/.exec(ref)
  if (annotation) return `${READER_ORIGIN}/#annotation-${annotation[1]}`
  return `${READER_ORIGIN}/`
}
