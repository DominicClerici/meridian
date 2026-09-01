import { store } from "../store"
import { MAX_RECENT_QUERIES } from "../defaults"
import type { RecentQuery, SearchLearning } from "../defaults"

/**
 * Recent queries and the learned ranking, both `local` and never synced — a
 * list of what you have searched for belongs to this browser.
 *
 * Two signals, deliberately different in strength. `byQuery` is the sharp one:
 * the single result a query ended in, which is what makes the second search for
 * a thing land on it directly. `picks` is the blunt one: how often a result
 * gets chosen at all, which nudges familiar rows up without overriding a better
 * match.
 */

/** Halved rather than decayed continuously — one pass, and the ratios survive. */
const PICK_CEILING = 400
/** Query→result memory beyond this stops being memory and starts being a log. */
const MAX_LEARNED_QUERIES = 120

function enabled(): boolean {
  return store.sync.get("searchRecents")
}

function learning(): SearchLearning {
  const raw = store.local.get("searchLearning")
  return {
    picks: raw?.picks ?? {},
    byQuery: raw?.byQuery ?? {},
  }
}

function key(query: string): string {
  return query.trim().toLowerCase()
}

export function recentQueries(limit = MAX_RECENT_QUERIES): RecentQuery[] {
  if (!enabled()) return []
  return store.local.get("searchRecentQueries").slice(0, limit)
}

export function recordQuery(text: string): void {
  if (!enabled()) return
  const trimmed = text.trim()
  if (trimmed.length < 2) return

  const existing = store.local.get("searchRecentQueries")
  const deduped = existing.filter((q) => key(q.text) !== key(trimmed))
  deduped.unshift({ text: trimmed, at: Date.now() })
  store.local.set("searchRecentQueries", deduped.slice(0, MAX_RECENT_QUERIES))
}

export function recordPick(candidateId: string, query: string): void {
  if (!enabled()) return

  const state = learning()
  const picks = { ...state.picks }
  picks[candidateId] = (picks[candidateId] ?? 0) + 1

  let total = 0
  for (const n of Object.values(picks)) total += n
  if (total > PICK_CEILING) {
    for (const id of Object.keys(picks)) {
      const halved = picks[id] / 2
      if (halved < 0.5) delete picks[id]
      else picks[id] = halved
    }
  }

  const byQuery = { ...state.byQuery }
  const k = key(query)
  if (k.length >= 2) {
    delete byQuery[k]
    byQuery[k] = candidateId
    const keys = Object.keys(byQuery)
    for (let i = 0; i < keys.length - MAX_LEARNED_QUERIES; i++) {
      delete byQuery[keys[i]]
    }
  }

  store.local.set("searchLearning", { picks, byQuery })
}

/**
 * Added to a candidate's score. Capped well below the range a match score can
 * move through, so learning breaks ties rather than overriding relevance.
 */
export function learnedBoost(candidateId: string, query: string): number {
  if (!enabled()) return 0
  const state = learning()

  let boost = 0
  if (state.byQuery[key(query)] === candidateId) boost += 0.45
  const picks = state.picks[candidateId] ?? 0
  if (picks > 0) boost += Math.min(0.2, Math.log2(1 + picks) / 14)
  return boost
}

export function clearSearchHistory(): void {
  store.local.set("searchRecentQueries", [])
  store.local.set("searchLearning", { picks: {}, byQuery: {} })
}

export function hasSearchHistory(): boolean {
  const state = learning()
  return (
    store.local.get("searchRecentQueries").length > 0 ||
    Object.keys(state.picks).length > 0
  )
}
