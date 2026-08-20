import type { SyncSettings, LocalSettings } from "./defaults"
import { syncDefaults, localDefaults } from "./defaults"

const browserApi = globalThis.browser ?? globalThis.chrome

const LS_PREFIX = "sp:"

type Callback<V> = (value: V) => void

export interface StoreNamespace<T extends Record<string, unknown>> {
  get<K extends keyof T>(key: K): T[K]
  set<K extends keyof T>(key: K, value: T[K]): void
  delete<K extends keyof T>(key: K): void
  subscribe<K extends keyof T>(key: K, callback: Callback<T[K]>): () => void
}

interface NamespaceInternal<T extends Record<string, unknown>>
  extends StoreNamespace<T> {
  reconcile(): Promise<void>
  handleExternalChange(key: string, newValue: unknown): void
}

function createNamespace<T extends Record<string, unknown>>(
  area: "sync" | "local",
  defaults: T,
  storage: BrowserStorageArea | null
): NamespaceInternal<T> {
  const cache = { ...defaults }
  const subscribers = new Map<keyof T, Set<Callback<any>>>()
  const prefix = `${LS_PREFIX}${area}:`

  // Instant load from localStorage
  for (const key of Object.keys(defaults)) {
    const raw = localStorage.getItem(`${prefix}${key}`)
    if (raw !== null) {
      try {
        ;(cache as any)[key] = JSON.parse(raw)
      } catch {
        // Corrupted localStorage entry — keep default
      }
    }
  }

  function notify<K extends keyof T>(key: K, value: T[K]): void {
    const subs = subscribers.get(key)
    if (subs) {
      for (const cb of subs) {
        cb(value)
      }
    }
  }

  return {
    get<K extends keyof T>(key: K): T[K] {
      return cache[key]
    },

    set<K extends keyof T>(key: K, value: T[K]): void {
      cache[key] = value
      try {
        localStorage.setItem(`${prefix}${String(key)}`, JSON.stringify(value))
      } catch {
        /* quota or security error */
      }
      storage?.set({ [key as string]: value }).catch(() => {})
      notify(key, value)
    },

    delete<K extends keyof T>(key: K): void {
      const defaultVal = defaults[key]
      cache[key] = defaultVal
      try {
        localStorage.removeItem(`${prefix}${String(key)}`)
      } catch {
        /* security error */
      }
      storage?.remove(String(key)).catch(() => {})
      notify(key, defaultVal)
    },

    subscribe<K extends keyof T>(key: K, callback: Callback<T[K]>): () => void {
      if (!subscribers.has(key)) {
        subscribers.set(key, new Set())
      }
      subscribers.get(key)!.add(callback)
      return () => {
        subscribers.get(key)?.delete(callback)
      }
    },

    async reconcile(): Promise<void> {
      if (!storage) return
      try {
        const keys = Object.keys(defaults)
        const result = await storage.get(keys)
        for (const key of keys) {
          if (key in result) {
            const val = result[key] as T[keyof T]
            if (JSON.stringify(cache[key as keyof T]) !== JSON.stringify(val)) {
              ;(cache as any)[key] = val
              try {
                localStorage.setItem(`${prefix}${key}`, JSON.stringify(val))
              } catch {
                /* quota or security error */
              }
              notify(key as keyof T, val)
            }
          }
        }
      } catch {
        // browser.storage unavailable — localStorage-only mode
      }
    },

    handleExternalChange(key: string, newValue: unknown): void {
      const k = key as keyof T
      if (!(k in defaults)) return
      // undefined means key was deleted in another tab — reset to default
      const val = (
        newValue === undefined ? defaults[k] : newValue
      ) as T[keyof T]
      if (JSON.stringify(cache[k]) !== JSON.stringify(val)) {
        cache[k] = val
        try {
          if (newValue === undefined) {
            localStorage.removeItem(`${prefix}${key}`)
          } else {
            localStorage.setItem(`${prefix}${key}`, JSON.stringify(val))
          }
        } catch {
          /* quota or security error */
        }
        notify(k, val)
      }
    },
  }
}

function getStorage(area: "sync" | "local"): BrowserStorageArea | null {
  try {
    return browserApi?.storage?.[area] ?? null
  } catch {
    return null
  }
}

const syncNs = createNamespace<SyncSettings>(
  "sync",
  syncDefaults,
  getStorage("sync")
)
const localNs = createNamespace<LocalSettings>(
  "local",
  localDefaults,
  getStorage("local")
)

export const store = {
  sync: {
    get: syncNs.get,
    set: syncNs.set,
    delete: syncNs.delete,
    subscribe: syncNs.subscribe,
  } as StoreNamespace<SyncSettings>,

  local: {
    get: localNs.get,
    set: localNs.set,
    delete: localNs.delete,
    subscribe: localNs.subscribe,
  } as StoreNamespace<LocalSettings>,

  async init(): Promise<void> {
    await Promise.all([syncNs.reconcile(), localNs.reconcile()])

    // Cross-tab synchronization
    try {
      browserApi?.storage?.onChanged?.addListener((changes, areaName) => {
        const ns =
          areaName === "sync" ? syncNs : areaName === "local" ? localNs : null
        if (!ns) return
        for (const [key, change] of Object.entries(changes)) {
          ns.handleExternalChange(key, change.newValue)
        }
      })
    } catch {
      // browser.storage unavailable
    }
  },
}
