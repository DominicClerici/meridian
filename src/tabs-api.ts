import { api, invoke } from "./ext-call"

/**
 * `tabs` is an optional permission, so this has the same three states as
 * `bookmarks-api.ts`: absent entirely, present but ungranted, or usable.
 * Without the grant `chrome.tabs.query` still resolves — it just omits `url`
 * and `title`, which is exactly the data tab search needs, so `granted` is
 * checked rather than inferred from the API's presence.
 */

export function tabsSupported(): boolean {
  return Boolean(api?.permissions && api?.tabs)
}

export function tabsGranted(): Promise<boolean> {
  const permissions = api?.permissions
  if (!permissions) return Promise.resolve(false)
  return invoke<boolean>(
    (p, cb) => permissions.contains(p as ExtPermissions, cb),
    { permissions: ["tabs"] }
  ).catch(() => false)
}

/**
 * Must be called straight from a click — Chrome rejects a permission request
 * that isn't synchronous with a user gesture, so nothing may be awaited first.
 */
export function requestTabs(): Promise<boolean> {
  const permissions = api?.permissions
  if (!permissions) return Promise.resolve(false)
  return invoke<boolean>(
    (p, cb) => permissions.request(p as ExtPermissions, cb),
    { permissions: ["tabs"] }
  ).catch(() => false)
}

export function queryTabs(): Promise<ExtTab[]> {
  const tabs = api?.tabs
  if (!tabs) return Promise.resolve([])
  return invoke<ExtTab[]>((q, cb) => tabs.query(q as object, cb), {}).catch(() => [])
}

/**
 * Focusing the window as well as the tab: activating a tab in a background
 * window otherwise looks like nothing happened.
 */
export async function activateTab(tabId: number, windowId?: number): Promise<void> {
  const tabs = api?.tabs
  if (!tabs) return
  try {
    await invoke<unknown>((_, cb) => tabs.update(tabId, { active: true }, cb), undefined)
    const windows = api?.windows
    if (windows && typeof windowId === "number") {
      await invoke<unknown>(
        (_, cb) => windows.update(windowId, { focused: true }, cb),
        undefined
      )
    }
  } catch {
    // The tab closed between the query and the pick.
  }
}

/** The current tab, which should never offer to switch to itself. */
export function currentTabId(): Promise<number | null> {
  const tabs = api?.tabs
  if (!tabs) return Promise.resolve(null)
  return invoke<ExtTab[]>((q, cb) => tabs.query(q as object, cb), {
    active: true,
    currentWindow: true,
  })
    .then((found) => found[0]?.id ?? null)
    .catch(() => null)
}
