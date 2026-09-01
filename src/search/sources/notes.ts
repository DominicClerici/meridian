import { store } from "../../store"
import { icon } from "../../icons/registry"
import type { Candidate, QueryContext, SearchSource } from "../types"

/**
 * The notepad holds one freeform note, so "searching notes" means searching
 * *within* it: each non-empty line is a candidate, and picking one opens the
 * notepad. Matching the whole note as a single blob would rank it against every
 * word in it at once and tell you nothing about where the hit was.
 */
const MAX_LINE = 120

function openNotepad(): void {
  const trigger = document.getElementById("notepad-trigger") as HTMLButtonElement | null
  if (trigger && !trigger.hidden) trigger.click()
}

function lines(): { text: string; index: number }[] {
  const body = store.local.get("notepadBody")
  if (!body.trim()) return []
  return body
    .split("\n")
    .map((text, index) => ({ text: text.trim(), index }))
    .filter((line) => line.text.length > 1)
}

export const notesSource: SearchSource = {
  id: "notes",
  label: "Notes",
  token: "note",
  glyph: "notepad",
  weight: 1,
  limit: 2,
  scopedLimit: 15,
  available: () => store.sync.get("notepadEnabled") && Boolean(store.local.get("notepadBody").trim()),
  unavailable: () =>
    store.sync.get("notepadEnabled")
      ? { message: "The notepad is empty." }
      : { message: "The notepad widget is turned off." },
  query(ctx: QueryContext): Candidate[] {
    if (!ctx.text.trim() && !ctx.scoped) return []
    return lines().map((line) => ({
      id: `note:${line.index}`,
      title: line.text.slice(0, MAX_LINE),
      subtitle: `Line ${line.index + 1}`,
      icon: () => icon("notepad", { size: 16 }),
      copyValue: line.text,
      keepOpen: false,
      run: () => openNotepad(),
    }))
  },
  idle(): Candidate[] {
    return lines()
      .slice(0, 15)
      .map((line) => ({
        id: `note:${line.index}`,
        title: line.text.slice(0, MAX_LINE),
        subtitle: `Line ${line.index + 1}`,
        icon: () => icon("notepad", { size: 16 }),
        copyValue: line.text,
        run: () => openNotepad(),
      }))
  },
}
