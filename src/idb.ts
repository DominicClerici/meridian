const DB_NAME = "sp-images"
const STORE_NAME = "backgrounds"
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

export function idbGet(key: string): Promise<Blob | null> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly")
        const req = tx.objectStore(STORE_NAME).get(key)
        req.onsuccess = () => resolve(req.result ?? null)
        req.onerror = () => reject(req.error)
      })
  )
}

export function idbSet(key: string, blob: Blob): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite")
        const req = tx.objectStore(STORE_NAME).put(blob, key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      })
  )
}

export function idbDelete(key: string): Promise<void> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite")
        const req = tx.objectStore(STORE_NAME).delete(key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      })
  )
}
