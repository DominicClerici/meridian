export function prettyUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.includes("://") ? raw : `https://${raw}`)
  } catch {
    return raw
  }

  let host = url.hostname
  if (host.startsWith("www.")) host = host.slice(4)

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
