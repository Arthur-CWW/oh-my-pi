import { Database } from "bun:sqlite"

/**
 * Open a substrate SQLite database strictly read-only.
 *
 * WAL-mode databases (the browser-context mirror) can refuse a plain
 * read-only connection with SQLITE_CANTOPEN when SQLite cannot create the
 * -shm sidecar. The failure surfaces on the first statement, not at
 * construction, so probe with a real schema read before returning. Fall back
 * to an immutable open: safe for these short-lived CLI reads because
 * substrate syncs are manual and never concurrent with queries.
 */
export function openReadonly(dbPath: string): Database {
  const db = new Database(dbPath, { readonly: true })
  try {
    db.query("SELECT COUNT(*) FROM sqlite_master").get()
    return db
  } catch {
    db.close()
    return new Database(`file:${dbPath}?immutable=1`, { readonly: true })
  }
}
