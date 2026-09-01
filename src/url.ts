export function prettyUrl(raw: string): string {
  const trimmed = raw.trim()
  // mailto:/tel:/sms: have no host to shorten, and forcing them through the
  // https:// fallback below parses the scheme as a username.
  if (BARE_SCHEMES.test(trimmed)) return trimmed

  let url: URL
  try {
    url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`)
  } catch {
    return raw
  }

  let host = url.hostname
  if (host.startsWith("www.")) host = host.slice(4)
  // Without the port, every localhost shortcut reads identically.
  if (url.port) host += `:${url.port}`

  const segments = url.pathname.split("/").filter(Boolean)
  let path = ""
  if (segments.length === 1) {
    path = "/" + segments[0]
  } else if (segments.length > 1) {
    path = "/.../" + segments[segments.length - 1]
  }

  const suffix = url.search + url.hash
  return host + path + suffix
}

/**
 * Schemes that are meaningful without `//`. Anything else without `://` is
 * treated as a bare hostname the user meant `https://` for.
 */
const BARE_SCHEMES = /^(mailto|tel|sms):/i

/**
 * `javascript:` and `data:` reach `window.location.href` in dock.ts, so a
 * shortcut is a stored-XSS vector if these survive. `file:` and `blob:` can't
 * be navigated to from an extension page anyway.
 */
const UNSAFE_SCHEMES = /^\s*(javascript|data|vbscript|file|blob):/i

const ABSOLUTE = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * A bare string is only treated as a hostname if it could actually be one.
 * Without this, `new URL("https://not a url at all")` percent-encodes the
 * spaces and hands back a "valid" URL, so typing a sentence produced a
 * shortcut instead of a validation error.
 */
const PLAUSIBLE_HOST = /^(localhost|\[[0-9a-f:.]+\]|([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,})$/i

/**
 * Canonical form of whatever the user typed, or `""` when it can't be one.
 * Callers treat `""` as "not a usable address" — this is the only validation
 * a URL gets, so both the settings form and the model boundary call it.
 */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed || UNSAFE_SCHEMES.test(trimmed)) return ""

  const explicit = ABSOLUTE.test(trimmed) || BARE_SCHEMES.test(trimmed)
  const candidate = explicit ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(candidate)
    if (BARE_SCHEMES.test(candidate)) return url.href
    if (!url.hostname || /[%\s]/.test(url.hostname)) return ""
    // An explicit scheme is trusted — `http://wiki` is a real intranet host —
    // but a bare string has to look like a domain before we assume it is one.
    if (!explicit && !PLAUSIBLE_HOST.test(url.hostname)) return ""
    return url.href
  } catch {
    return ""
  }
}

/** The registrable host, minus `www.`, used for naming and duplicate checks. */
export function urlHost(raw: string): string {
  try {
    return new URL(normalizeUrl(raw) || raw).hostname.replace(/^www\./, "")
  } catch {
    return ""
  }
}
