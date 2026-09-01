import { icon } from "../../icons/registry"
import { showToast } from "../../components"
import { evaluate } from "../answers"
import type { Candidate, QueryContext, SearchSource } from "../types"

/**
 * Pinned to the top, because an answer is never what you have to scroll past to
 * reach something else — if it parsed as a calculation, it is what you meant.
 */
export const answersSource: SearchSource = {
  id: "answers",
  label: "Answer",
  token: "",
  glyph: "sparkle",
  weight: 1,
  limit: 1,
  available: () => true,
  query(ctx: QueryContext): Candidate[] {
    const answer = evaluate(ctx.text)
    if (!answer) return []

    return [
      {
        id: "answer",
        title: answer.value,
        subtitle: answer.label,
        detail: "copy",
        pin: "top",
        copyValue: answer.copy,
        icon: () => icon("sparkle", { size: 16 }),
        run: () => {
          navigator.clipboard?.writeText(answer.copy)
          showToast(`Copied ${answer.value}`)
        },
      },
    ]
  },
}
