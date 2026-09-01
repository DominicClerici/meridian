import { api, invoke } from "./ext-call"

/**
 * `bookmarks` is an optional permission, so this module has to cope with three
 * states, not two: the API can be absent entirely (a browser without it), or
 * present but ungranted (the normal first-run case), or usable.
 */

export function bookmarksSupported(): boolean {
  return Boolean(api?.permissions)
}

export function bookmarksGranted(): Promise<boolean> {
  const permissions = api?.permissions
  if (!permissions) return Promise.resolve(Boolean(api?.bookmarks))
  return invoke<boolean>(
    (p, cb) => permissions.contains(p as ExtPermissions, cb),
    { permissions: ["bookmarks"] }
  ).catch(() => false)
}

/**
 * Must be called straight from a click — Chrome rejects a permission request
 * that isn't synchronous with a user gesture, so nothing may be awaited first.
 */
export function requestBookmarks(): Promise<boolean> {
  const permissions = api?.permissions
  if (!permissions) return Promise.resolve(Boolean(api?.bookmarks))
  return invoke<boolean>(
    (p, cb) => permissions.request(p as ExtPermissions, cb),
    { permissions: ["bookmarks"] }
  ).catch(() => false)
}

export function bookmarksGetTree(): Promise<BookmarkTreeNode[]> {
  const bookmarks = api?.bookmarks
  if (!bookmarks) return Promise.reject(new Error("Bookmarks API unavailable"))
  return invoke<BookmarkTreeNode[]>((_, cb) => bookmarks.getTree(cb), undefined)
}
