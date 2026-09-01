/**
 * Subsequence matching and scoring.
 *
 * The old search ranked nothing: results came out in provider order, so a
 * shortcut named exactly the query could lose to three partial matches that
 * happened to sit earlier in the list. Everything here exists to make the row
 * you meant come first.
 *
 * The model is fzf's: find the tightest window of the haystack that contains
 * the needle as a subsequence, then score the characters inside it by *where*
 * they landed — the start of a word is worth more than the middle of one, and a
 * run of adjacent characters is worth more than the same characters scattered.
 */

export type Match = {
  /** Normalized 0–1. Comparable across haystacks of different lengths. */
  score: number
  /** Indices into the haystack that matched, for highlighting. */
  positions: number[]
}

const SCORE_MATCH = 16
const BONUS_BOUNDARY = 14
const BONUS_CAMEL = 10
const BONUS_CONSECUTIVE = 12
const BONUS_FIRST = 18
const PENALTY_GAP_START = 7
const PENALTY_GAP_EXTRA = 2.5

/** Anything a human would read as the end of a word, including URL punctuation. */
const BOUNDARY = new Set([
  " ", "\t", "\n", "-", "_", ".", "/", "\\", ":", ",", "(", ")", "[", "]",
  "{", "}", "@", "#", "?", "&", "=", "+", "'", '"', "|", "~", "*",
])

/**
 * Below this a match is noise — a few letters scattered across a long string
 * that happen to be in order. Dropping them entirely is what keeps a stray
 * substring hit from outranking what you meant.
 */
export const MATCH_FLOOR = 0.32

function isBoundary(prev: string | undefined): boolean {
  return prev === undefined || BOUNDARY.has(prev)
}

function isCamel(prev: string, cur: string): boolean {
  return prev >= "a" && prev <= "z" && cur >= "A" && cur <= "Z"
}

/**
 * The tightest slice of `hay` containing `needle` as a subsequence: forward to
 * find where it can end, then backward from there to find where it can start.
 * Without the backward pass, "git" against "github.com/git" would anchor on the
 * first `g` and score as a scattered match instead of an exact word.
 */
function window(needle: string, hay: string): [number, number] | null {
  let ni = 0
  let end = -1
  for (let i = 0; i < hay.length && ni < needle.length; i++) {
    if (hay[i] === needle[ni]) {
      ni++
      if (ni === needle.length) end = i
    }
  }
  if (end < 0) return null

  ni = needle.length - 1
  let start = 0
  for (let i = end; i >= 0; i--) {
    if (hay[i] === needle[ni]) {
      ni--
      if (ni < 0) {
        start = i
        break
      }
    }
  }
  return [start, end]
}

export function fuzzyMatch(needle: string, haystack: string): Match | null {
  if (!needle) return null
  if (!haystack) return null

  const n = needle.toLowerCase()
  const h = haystack.toLowerCase()

  if (h === n) return { score: 1, positions: range(0, n.length) }

  const bounds = window(n, h)
  if (!bounds) return null
  const [start, end] = bounds

  const positions: number[] = []
  let score = 0
  let ni = 0
  let prevMatched = -2

  for (let i = start; i <= end && ni < n.length; i++) {
    if (h[i] !== n[ni]) continue

    let charScore = SCORE_MATCH
    if (i === 0) charScore += BONUS_FIRST
    else if (isBoundary(h[i - 1])) charScore += BONUS_BOUNDARY
    else if (isCamel(haystack[i - 1], haystack[i])) charScore += BONUS_CAMEL

    if (prevMatched === i - 1) charScore += BONUS_CONSECUTIVE
    else if (prevMatched >= 0) {
      const gap = i - prevMatched - 1
      charScore -= PENALTY_GAP_START + (gap - 1) * PENALTY_GAP_EXTRA
    }

    score += charScore
    positions.push(i)
    prevMatched = i
    ni++
  }

  if (ni < n.length) return null

  // A perfect prefix match of the same length is the ceiling, so scores from
  // different haystacks stay comparable.
  const ideal =
    n.length * (SCORE_MATCH + BONUS_CONSECUTIVE) + BONUS_FIRST - BONUS_CONSECUTIVE
  let normalized = Math.max(0, Math.min(1, score / ideal))

  // A single character matches almost anything; only honour it at a boundary.
  if (n.length === 1 && positions[0] !== 0 && !isBoundary(h[positions[0] - 1])) {
    normalized *= 0.35
  }

  // How much of the span the match actually fills. Without this, "git" scores
  // "Graphite" nearly as well as "GitHub" — the characters are all there and in
  // order, they are just nowhere near each other.
  const span = positions[positions.length - 1] - positions[0] + 1
  normalized *= 0.6 + 0.4 * (n.length / span)

  // Floors that keep the obvious answer on top regardless of length effects.
  if (h.startsWith(n)) normalized = Math.max(normalized, 0.92)
  else if (startsAWord(h, n)) normalized = Math.max(normalized, 0.78)

  return { score: normalized, positions }
}

function startsAWord(hay: string, needle: string): boolean {
  let from = 0
  for (;;) {
    const at = hay.indexOf(needle, from)
    if (at < 0) return false
    if (isBoundary(hay[at - 1])) return true
    from = at + 1
  }
}

function range(from: number, length: number): number[] {
  const out: number[] = []
  for (let i = 0; i < length; i++) out.push(from + i)
  return out
}

/**
 * The best of several fields. Secondary fields are discounted so a title hit
 * beats a URL hit of the same quality — a shortcut called "Mail" should outrank
 * one that merely lives on `mail.example.com`.
 */
const SECONDARY_WEIGHT = 0.82

export function bestMatch(needle: string, primary: string, secondary?: string[]): Match | null {
  let best = fuzzyMatch(needle, primary)
  if (best && best.score >= 0.92) return best

  for (const field of secondary ?? []) {
    const m = fuzzyMatch(needle, field)
    if (!m) continue
    const scaled = m.score * SECONDARY_WEIGHT
    if (!best || scaled > best.score) best = { score: scaled, positions: [] }
  }
  return best
}

/**
 * How a match, the source's confidence in it, and what you have picked before
 * combine. Weight dominates so sources stay in a sensible order; boost and
 * learning break ties within one.
 */
export function combine(
  match: number,
  weight: number,
  boost: number | undefined,
  learned: number
): number {
  return match * weight + (boost ?? 0.5) * 0.12 + learned
}
