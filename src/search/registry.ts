import { store } from "../store"
import { bestMatch, combine, MATCH_FLOOR } from "./rank"
import { learnedBoost } from "./recents"
import type {
  Candidate,
  QueryContext,
  Ranked,
  SearchSource,
  SearchSourceId,
  Unavailable,
} from "./types"

/**
 * Registration, fan-out and ranking.
 *
 * The old engine queried every provider synchronously and concatenated the
 * results, which meant no source could ever await — history, bookmarks and tab
 * search were all locked out by the interface. Here a source may return a
 * promise, and each one patches into the list as it lands, so a cached source
 * paints on the first frame while a network one is still in flight.
 */

const registry = new Map<SearchSourceId, SearchSource>()

export function registerSource(source: SearchSource): void {
  registry.set(source.id, source)
}

export function allSources(): SearchSource[] {
  return [...registry.values()]
}

export function getSource(id: SearchSourceId): SearchSource | undefined {
  return registry.get(id)
}

export function sourceByToken(token: string): SearchSource | undefined {
  const lower = token.toLowerCase()
  return allSources().find((s) => s.token === lower)
}

/** Registered, turned on in settings, and actually able to answer right now. */
export function enabledSources(): SearchSource[] {
  const disabled = new Set(store.sync.get("searchDisabledSources"))
  return allSources().filter((s) => !disabled.has(s.id) && s.available())
}

/** Turned on in settings, whether or not it can answer — for the `@` picker. */
export function offeredSources(): SearchSource[] {
  const disabled = new Set(store.sync.get("searchDisabledSources"))
  return allSources().filter((s) => !disabled.has(s.id) && s.token !== "")
}

export type SearchUpdate = {
  rows: Ranked[]
  /** At least one source has not resolved yet. */
  pending: boolean
  /** Scoped to a source that can't answer, and why. */
  notice: Unavailable | null
}

export type SearchRun = { cancel(): void }

type Bucket = { source: SearchSource; rows: Ranked[] }

export function runSearch(opts: {
  text: string
  raw: string
  bang: string | null
  scope: SearchSource | null
  onUpdate(update: SearchUpdate): void
}): SearchRun {
  const controller = new AbortController()
  const { signal } = controller

  const scoped = opts.scope
  if (scoped && !scoped.available()) {
    const notice = scoped.unavailable?.() ?? {
      message: `${scoped.label} isn't connected.`,
    }
    opts.onUpdate({ rows: [], pending: false, notice })
    return { cancel: () => controller.abort() }
  }

  const targets = scoped
    ? [scoped]
    : enabledSources().filter((s) => !s.scopedOnly)

  const buckets = new Map<SearchSourceId, Bucket>()
  let outstanding = targets.length
  let frame = 0

  function emit(): void {
    if (signal.aborted) return
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      if (signal.aborted) return
      opts.onUpdate({
        rows: merge([...buckets.values()], Boolean(scoped)),
        pending: outstanding > 0,
        notice: null,
      })
    })
  }

  for (const source of targets) {
    const ctx: QueryContext = {
      text: opts.text,
      raw: opts.raw,
      bang: opts.bang,
      signal,
      limit: scoped ? source.scopedLimit ?? source.limit : source.limit,
      scoped: Boolean(scoped),
    }

    const produce = (): Candidate[] | Promise<Candidate[]> => {
      try {
        return !ctx.text.trim() && ctx.scoped && source.idle
          ? source.idle(ctx)
          : source.query(ctx)
      } catch {
        return []
      }
    }

    const produced: Candidate[] | Promise<Candidate[]> = source.debounce
      ? new Promise<Candidate[]>((resolve) => {
          const timer = setTimeout(() => resolve(Promise.resolve(produce())), source.debounce)
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer)
              resolve([])
            },
            { once: true }
          )
        })
      : produce()

    Promise.resolve(produced)
      .catch(() => [] as Candidate[])
      .then((candidates) => {
        outstanding--
        if (signal.aborted) return
        buckets.set(source.id, {
          source,
          rows: rankSource(source, candidates, ctx),
        })
        emit()
      })
  }

  // Sources that answered synchronously have already filled their bucket; this
  // paints them without waiting for a microtask turn.
  emit()

  return {
    cancel(): void {
      controller.abort()
      if (frame) cancelAnimationFrame(frame)
    },
  }
}

function rankSource(
  source: SearchSource,
  candidates: Candidate[],
  ctx: QueryContext
): Ranked[] {
  const query = ctx.text.trim()
  const rows: Ranked[] = []

  for (const candidate of candidates) {
    if (candidate.pin) {
      rows.push({ candidate, source, group: source.label, score: 0 })
      continue
    }

    // An empty query can't be matched against, and a prematched candidate
    // shouldn't be: either way the source's own ordering stands.
    if (!query || candidate.prematched) {
      rows.push({
        candidate,
        source,
        group: source.label,
        score: combine(1, source.weight, candidate.boost, 0),
      })
      continue
    }

    const match = bestMatch(query, candidate.title, [
      ...(candidate.subtitle ? [candidate.subtitle] : []),
      ...(candidate.haystack ?? []),
    ])
    if (!match || match.score < MATCH_FLOOR) continue

    rows.push({
      candidate,
      source,
      group: source.label,
      score: combine(
        match.score,
        source.weight,
        candidate.boost,
        learnedBoost(candidate.id, query)
      ),
      positions: match.positions,
    })
  }

  rows.sort((a, b) => b.score - a.score)
  return rows.slice(0, ctx.limit)
}

/**
 * Grouped, not interleaved: rows stay under their source's heading, and the
 * *groups* are ordered by their best row. That keeps relevance global while the
 * list still reads as sections rather than a shuffled pile.
 */
function merge(buckets: Bucket[], scoped: boolean): Ranked[] {
  const top: Ranked[] = []
  const bottom: Ranked[] = []
  const groups: Ranked[][] = []

  for (const bucket of buckets) {
    const body: Ranked[] = []
    for (const row of bucket.rows) {
      if (row.candidate.pin === "top") top.push(row)
      else if (row.candidate.pin === "bottom") bottom.push(row)
      else body.push(row)
    }
    if (body.length) groups.push(body)
  }

  groups.sort((a, b) => b[0].score - a[0].score)

  const out = [...top]
  for (const group of groups) out.push(...group)
  out.push(...bottom)

  // Scoped to one source, the heading only repeats the pill already in the
  // input, so it is dropped.
  if (scoped) for (const row of out) row.group = ""
  return out
}
