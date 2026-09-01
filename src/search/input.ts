import { getSource, sourceByToken } from "./registry"
import type { SearchSource } from "./types"

/**
 * The input grammar.
 *
 * Three prefixes, chosen because they don't collide with anything you'd type at
 * the start of a real query: `>` runs a command, `@` picks a source, and `!`
 * re-targets the web-search row the way DuckDuckGo's bangs do. Parsing is pure
 * — the pill, the picker and the placeholder are all derived from this, so
 * there is one definition of what the text currently means.
 */

export type Parsed = {
  /** The source this query is locked to, from a pill or a resolved `@token`. */
  scope: SearchSource | null
  /** The `!bang` key, if one was typed. */
  bang: string | null
  /** What the sources should actually search for. */
  text: string
  /**
   * A partially typed `@token`. Non-null means the source picker is showing —
   * `""` right after the `@`, then whatever has been typed since.
   */
  picker: string | null
}

const BANG = /(^|\s)!([a-z0-9]+)(?=\s|$)/i

export function parseInput(raw: string, locked: SearchSource | null): Parsed {
  let text = raw
  let bang: string | null = null

  const bangMatch = text.match(BANG)
  if (bangMatch) {
    bang = bangMatch[2].toLowerCase()
    text = (text.slice(0, bangMatch.index) + text.slice(bangMatch.index! + bangMatch[0].length)).trim()
  }

  if (locked) return { scope: locked, bang, text, picker: null }

  if (text.startsWith(">")) {
    return { scope: getSource("commands") ?? null, bang, text: text.slice(1).trimStart(), picker: null }
  }

  if (text.startsWith("@")) {
    const m = text.match(/^@([a-z]*)(\s+)?([\s\S]*)$/i)
    if (m) {
      const source = m[1] ? sourceByToken(m[1]) : undefined
      // A space is what commits the token: `@ma` is still being typed, `@mail `
      // has been chosen.
      if (source && m[2]) return { scope: source, bang, text: m[3], picker: null }
      return { scope: null, bang, text: "", picker: m[1] }
    }
  }

  return { scope: null, bang, text, picker: null }
}
