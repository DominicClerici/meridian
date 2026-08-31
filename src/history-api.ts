/**
 * One `history` wrapper for both calling conventions.
 *
 * Chrome's `chrome.*` is callback-first and returns nothing. Firefox's
 * `browser.*` is promise-only: it never invokes a trailing callback, and its
 * argument validation rejects the extra parameter outright. Passing a callback
 * *and* taking the return value covers both, with the throw as the third case.
 */

const api = globalThis.browser ?? globalThis.chrome

export type HistoryQuery = {
  text: string
  startTime?: number
  endTime?: number
  maxResults?: number
}

function isThenable(value: unknown): value is Promise<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === "function"
}

function invoke<T>(
  fn: (arg: unknown, cb?: (results: T) => void) => unknown,
  arg: unknown
): Promise<T> {
  let resolveCb!: (results: T) => void
  let rejectCb!: (reason: Error) => void
  const viaCallback = new Promise<T>((resolve, reject) => {
    resolveCb = resolve
    rejectCb = reject
  })

  let returned: unknown
  try {
    returned = fn(arg, (results: T) => {
      const err = (globalThis.chrome as any)?.runtime?.lastError
      if (err) rejectCb(new Error(err.message))
      else resolveCb(results)
    })
  } catch {
    returned = fn(arg)
  }

  return isThenable(returned) ? (returned as Promise<T>) : viaCallback
}

export function historySearch(query: HistoryQuery): Promise<HistoryItem[]> {
  if (!api?.history) return Promise.reject(new Error("History API unavailable"))
  return invoke<HistoryItem[]>((q, cb) => api.history.search(q as HistoryQuery, cb), query)
}

export function historyGetVisits(details: { url: string }): Promise<VisitItem[]> {
  if (!api?.history) return Promise.reject(new Error("History API unavailable"))
  return invoke<VisitItem[]>((d, cb) => api.history.getVisits(d as { url: string }, cb), details)
}
