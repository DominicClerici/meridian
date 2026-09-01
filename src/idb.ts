const DB_NAME = "sp-images"
const BACKGROUNDS = "backgrounds"
const SHORTCUT_ICONS = "shortcut-icons"
const DB_VERSION = 2

export type ImageStore = typeof BACKGROUNDS | typeof SHORTCUT_ICONS

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        for (const name of [BACKGROUNDS, SHORTCUT_ICONS]) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function run<T>(
  store: ImageStore,
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = op(db.transaction(store, mode).objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

export function idbGetFrom(store: ImageStore, key: string): Promise<Blob | null> {
  return run<Blob | undefined>(store, "readonly", (s) => s.get(key)).then((v) => v ?? null)
}

export function idbSetIn(store: ImageStore, key: string, blob: Blob): Promise<void> {
  return run<IDBValidKey>(store, "readwrite", (s) => s.put(blob, key)).then(() => undefined)
}

export function idbDeleteIn(store: ImageStore, key: string): Promise<void> {
  return run<undefined>(store, "readwrite", (s) => s.delete(key)).then(() => undefined)
}

export function idbKeysIn(store: ImageStore): Promise<string[]> {
  return run<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys()).then((keys) =>
    keys.map(String)
  )
}

export const idbGet = (key: string): Promise<Blob | null> => idbGetFrom(BACKGROUNDS, key)
export const idbSet = (key: string, blob: Blob): Promise<void> => idbSetIn(BACKGROUNDS, key, blob)
export const idbDelete = (key: string): Promise<void> => idbDeleteIn(BACKGROUNDS, key)

export const ICON_STORE: ImageStore = SHORTCUT_ICONS
