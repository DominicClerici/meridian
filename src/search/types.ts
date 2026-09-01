import type { SearchSourceId } from "../defaults"

export type { SearchSourceId }

/** What Enter, ⌘Enter and a middle-click mean. Copy is handled by the engine. */
export type RunMode = "default" | "newTab"

export type RowAction = {
  id: string
  label: string
  /** Icon registry glyph name. */
  glyph?: string
  run(): void
  /** Leaves the palette open — for actions you might do several of. */
  keepOpen?: boolean
  destructive?: boolean
}

export type Candidate = {
  /**
   * Stable across queries and sessions: it keys row reuse, the icon cache, and
   * the learned ranking. A url or a record id, never an array index.
   */
  id: string
  title: string
  subtitle?: string
  /** Right-aligned meta — a timestamp, a repo, a state. */
  detail?: string
  icon(): HTMLElement
  /**
   * Changes when the icon should be rebuilt. Rows are reused by `id` and their
   * icons with them — which is what stops favicons re-fetching on every
   * keystroke, and what would otherwise leave a ticked todo drawn unticked.
   */
  iconKey?: string
  /** Extra strings the matcher may match against, e.g. a URL or an identifier. */
  haystack?: string[]
  /**
   * Source-supplied 0–1 quality signal (recency, priority, visit count) mixed
   * into the final score. Absent is treated as 0.5.
   */
  boost?: number
  /**
   * Skips matching and takes a reserved slot. `top` is for answers and direct
   * navigation; `bottom` is the web-search escape hatch.
   */
  pin?: "top" | "bottom"
  /**
   * Already ordered by whoever produced it — engine autocomplete, most of all.
   * Skips matching entirely, so a suggestion the matcher would have scored
   * poorly still shows in the order the engine returned it.
   */
  prematched?: boolean
  /** What ⌘C puts on the clipboard. Falls back to subtitle, then title. */
  copyValue?: string
  actions?: RowAction[]
  run(mode: RunMode): void
  /** Leaves the palette open after running. */
  keepOpen?: boolean
}

export type QueryContext = {
  /** The query with any scope token and engine bang already stripped. */
  text: string
  /** Everything the user typed. */
  raw: string
  /** The `!bang` key, if one led the query. */
  bang: string | null
  signal: AbortSignal
  limit: number
  /** True when the user has explicitly scoped to this source. */
  scoped: boolean
}

/** Why a source can't answer, and the one-click fix when there is one. */
export type Unavailable = {
  message: string
  action?: RowAction
}

export type SearchSource = {
  id: SearchSourceId
  /** Group heading, and the label on the scope pill. */
  label: string
  /** The `@` token that scopes to this source. */
  token: string
  glyph: string
  /**
   * Multiplies the match score. Sources whose matches are more likely to be
   * what you meant sit above ones that merely contain the string.
   */
  weight: number
  /** How many rows this source may contribute to the blended list. */
  limit: number
  /** How many when scoped to it. Defaults to `limit`. */
  scopedLimit?: number
  /** Never appears in the blended list — too slow or too noisy to mix in. */
  scopedOnly?: boolean
  /**
   * Wait this long before querying. Each keystroke cancels the run before it,
   * so a source that costs a network request only pays for the pause you
   * actually took — while cached sources stay on the first frame.
   */
  debounce?: number
  available(): boolean
  /** Rendered instead of results when scoped to an unavailable source. */
  unavailable?(): Unavailable | null
  query(ctx: QueryContext): Candidate[] | Promise<Candidate[]>
  /** Rows for an empty query — only asked when this source is scoped. */
  idle?(ctx: QueryContext): Candidate[] | Promise<Candidate[]>
}

/** A candidate that survived ranking, with the score and group it landed in. */
export type Ranked = {
  candidate: Candidate
  /** Null for the synthetic rows of the empty state, which scope to nothing. */
  source: SearchSource | null
  /** Section heading. Empty renders the row with no heading above it. */
  group: string
  score: number
  /** Matched indices in the title, for highlighting. */
  positions?: number[]
}
