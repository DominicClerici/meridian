import { api, invoke } from "./ext-call"

export type HistoryQuery = {
  text: string
  startTime?: number
  endTime?: number
  maxResults?: number
}

export function historySearch(query: HistoryQuery): Promise<HistoryItem[]> {
  const history = api?.history
  if (!history) return Promise.reject(new Error("History API unavailable"))
  return invoke<HistoryItem[]>((q, cb) => history.search(q as HistoryQuery, cb), query)
}

export function historyGetVisits(details: { url: string }): Promise<VisitItem[]> {
  const history = api?.history
  if (!history) return Promise.reject(new Error("History API unavailable"))
  return invoke<VisitItem[]>((d, cb) => history.getVisits(d as { url: string }, cb), details)
}

export function historyAvailable(): boolean {
  return Boolean(api?.history)
}
