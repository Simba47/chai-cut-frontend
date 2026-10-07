import postgres from 'postgres'

const g = global as typeof globalThis & { _sql?: postgres.Sql; _sqlSettings?: number }

// The database is reached through Railway's public proxy, which silently drops a connection that
// sits idle for a while. A query sent on such a connection fails with ECONNRESET /
// CONNECTION_CLOSED (a save failed after 32 s, the editor page showed its error screen). So:
// close idle connections ourselves first (idle_timeout, seconds), keep the TCP connection alive
// while it's in use (keep_alive), renew connections now and then (max_lifetime), and give up on
// a connection that can't be made instead of hanging (connect_timeout).
export const DB_IDLE_TIMEOUT_S = 20
const POOL_MAX = 5
/** Raise when the pool's settings below change: a running dev server then makes a new pool */
const SETTINGS = 2

// `next dev` keeps the pool across code reloads (it lives on `global`), so a dev server started
// before a settings change would keep its old pool — and its dead connections — until restarted.
// In development a pool made with other settings is closed and replaced. (A pool put on
// `global` by a test is left alone: tests don't run in development mode.)
if (g._sql && process.env.NODE_ENV === 'development' && g._sqlSettings !== SETTINGS) {
  g._sql.end({ timeout: 5 }).catch(() => {})
  g._sql = undefined
}
if (!g._sql) {
  g._sql = postgres(process.env.DATABASE_URL!, {
    ssl: 'require', max: POOL_MAX,
    idle_timeout: DB_IDLE_TIMEOUT_S, keep_alive: 15, max_lifetime: 30 * 60, connect_timeout: 15,
  })
  g._sqlSettings = SETTINGS
}

/** Errors that mean the connection dropped (not that the query was wrong) */
const DROPPED = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED', 'CONNECT_TIMEOUT'])
/**
 * Errors that mean the database was never reached: its name could not be looked up (the PC's
 * or router's DNS missed a beat — "getaddrinfo ENOTFOUND sakura.proxy.rlwy.net"). No connection
 * was made, so nothing ran.
 */
const NOT_REACHED = new Set(['ENOTFOUND', 'EAI_AGAIN'])
const codeOf = (e: unknown) => String((e as { code?: unknown })?.code ?? '')
export const isNotReached = (e: unknown) => NOT_REACHED.has(codeOf(e))
export const isDroppedConnection = (e: unknown) => DROPPED.has(codeOf(e)) || isNotReached(e)

/** Waits before each further try: quick at first (a stale connection), longer for a lookup that needs a moment */
const RETRY_WAITS_MS = [150, 300, 600, 1200, 2400]

/** Runs `run`; while it fails with an error `again` accepts, waits and runs it again (at most once per wait above) */
async function withRetries<T>(run: () => Promise<T>, again: (e: unknown) => boolean, first?: Promise<T>): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await (n === 0 && first ? first : run())
    } catch (e) {
      if (!again(e) || n >= RETRY_WAITS_MS.length) throw e
      console.warn(`[db] ${isNotReached(e) ? 'database not reached' : 'connection dropped'} (${codeOf(e)}) — trying again`)
      await new Promise(r => setTimeout(r, RETRY_WAITS_MS[n]))
    }
  }
}

/** A read (SELECT / WITH … SELECT) changes nothing, so running it again is always safe */
function isRead(strings: TemplateStringsArray): boolean {
  const text = strings.join(' ').replace(/--[^\n]*/g, ' ').trim()
  return /^(select|with)\b/i.test(text) && !/\b(insert|update|delete|merge|alter|create|drop|truncate)\b/i.test(text)
}

/**
 * The connection pool, with two changes:
 * - A READ whose connection dropped (the network or the proxy cut it), or that never reached the
 *   database, is tried again before the error reaches the page — once per connection the pool
 *   can hold, so a pool whose connections have all gone stale still gets through on a fresh one.
 *   Writes are never repeated after a drop: one that reached the database would run twice.
 * - A transaction (sql.begin: every save) that never reached the database is started again:
 *   nothing of it ran.
 * Everything else (sql(rows), sql.json, fragments…) is the pool itself.
 */
const sql = new Proxy(g._sql, {
  apply(target, thisArg, args: unknown[]) {
    const strings = args[0] as TemplateStringsArray
    const first = Reflect.apply(target, thisArg, args)
    if (!Array.isArray(strings) || !('raw' in strings) || !isRead(strings)) return first
    let run: Promise<unknown> | null = null
    const result = () => (run ??= withRetries(() => Reflect.apply(target, thisArg, args) as Promise<unknown>, isDroppedConnection, first as Promise<unknown>))
    // Runs when awaited, like the query itself
    return {
      then: (ok?: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => result().then(ok, bad),
      catch: (bad?: (e: unknown) => unknown) => result().catch(bad),
      finally: (f?: () => void) => result().finally(f),
    }
  },
  get(target, prop) {
    const value = Reflect.get(target, prop)
    if (prop !== 'begin' || typeof value !== 'function') return value
    return (...args: unknown[]) => withRetries(() => Reflect.apply(value, target, args) as Promise<unknown>, isNotReached)
  },
}) as postgres.Sql
export default sql
