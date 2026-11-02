import type { SyncOutboxEvent } from '../types';

const DB_NAME = 'kiidfromdream_pos_idb';
const DB_VERSION = 1;
const STORE_OUTBOX = 'outbox_events';
const STORE_META = 'sync_meta';

let idbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * Open or create the IndexedDB database instance
 */
export function openIdb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  if (idbPromise) {
    return idbPromise;
  }

  idbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 1. Outbox events store
        if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
          const outboxStore = db.createObjectStore(STORE_OUTBOX, { keyPath: 'event_id' });
          outboxStore.createIndex('idx_store_id', 'store_id', { unique: false });
          outboxStore.createIndex('idx_status', 'status', { unique: false });
          outboxStore.createIndex('idx_created_at', 'created_at', { unique: false });
          outboxStore.createIndex('idx_store_status', ['store_id', 'status'], { unique: false });
        }

        // 2. Sync metadata store
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'store_id' });
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        resolve(db);
      };

      request.onerror = (event) => {
        console.warn('[IDB] Failed to open IndexedDB:', (event.target as IDBOpenDBRequest).error);
        resolve(null);
      };

      request.onblocked = () => {
        console.warn('[IDB] Database open blocked by another tab');
        resolve(null);
      };
    } catch (err) {
      console.warn('[IDB] Exception opening IndexedDB:', err);
      resolve(null);
    }
  });

  return idbPromise;
}

/**
 * Persist or update a single outbox event in IndexedDB
 */
export async function idbSaveEvent(event: SyncOutboxEvent): Promise<boolean> {
  try {
    const db = await openIdb();
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORE_OUTBOX);
      const req = store.put(event);

      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('[IDB] idbSaveEvent error:', err);
    return false;
  }
}

/**
 * Persist multiple outbox events in a single atomic transaction
 */
export async function idbSaveEvents(events: SyncOutboxEvent[]): Promise<boolean> {
  if (!events.length) return true;
  try {
    const db = await openIdb();
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORE_OUTBOX);

      for (const ev of events) {
        store.put(ev);
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
  } catch (err) {
    console.warn('[IDB] idbSaveEvents error:', err);
    return false;
  }
}

/**
 * Retrieve all outbox events for a given store from IndexedDB
 */
export async function idbGetEvents(storeId: string = 'store_default'): Promise<SyncOutboxEvent[]> {
  try {
    const db = await openIdb();
    if (!db) return [];

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_OUTBOX, 'readonly');
      const store = tx.objectStore(STORE_OUTBOX);
      const index = store.index('idx_store_id');
      const req = index.getAll(storeId);

      req.onsuccess = () => {
        const events = (req.result || []) as SyncOutboxEvent[];
        // Sort by client_timestamp / created_at ascending
        events.sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
        resolve(events);
      };

      req.onerror = () => {
        console.warn('[IDB] idbGetEvents error');
        resolve([]);
      };
    });
  } catch (err) {
    console.warn('[IDB] idbGetEvents exception:', err);
    return [];
  }
}

/**
 * Delete synced events by event_id from IndexedDB
 */
export async function idbDeleteEvents(eventIds: string[]): Promise<boolean> {
  if (!eventIds.length) return true;
  try {
    const db = await openIdb();
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORE_OUTBOX);

      for (const id of eventIds) {
        store.delete(id);
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('[IDB] idbDeleteEvents exception:', err);
    return false;
  }
}

/**
 * Mark events failed or update their retry count in IndexedDB
 */
export async function idbUpdateEventStatus(
  updates: Array<{ event_id: string; status: 'PENDING' | 'SYNCED' | 'FAILED'; retry_count?: number; last_error?: string }>
): Promise<boolean> {
  if (!updates.length) return true;
  try {
    const db = await openIdb();
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORE_OUTBOX);

      for (const u of updates) {
        const getReq = store.get(u.event_id);
        getReq.onsuccess = () => {
          const ev = getReq.result as SyncOutboxEvent | undefined;
          if (ev) {
            ev.status = u.status;
            if (u.retry_count !== undefined) ev.retry_count = u.retry_count;
            if (u.last_error !== undefined) ev.last_error = u.last_error;
            store.put(ev);
          }
        };
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  } catch (err) {
    console.warn('[IDB] idbUpdateEventStatus exception:', err);
    return false;
  }
}

/**
 * Save sync metadata in IndexedDB
 */
export async function idbSetMeta(
  storeId: string,
  meta: { lastServerVersion: number; lastSyncedAt: string | null }
): Promise<boolean> {
  try {
    const db = await openIdb();
    if (!db) return false;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      const store = tx.objectStore(STORE_META);
      const req = store.put({ store_id: storeId, ...meta });

      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

/**
 * Retrieve sync metadata from IndexedDB
 */
export async function idbGetMeta(
  storeId: string
): Promise<{ lastServerVersion: number; lastSyncedAt: string | null } | null> {
  try {
    const db = await openIdb();
    if (!db) return null;

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const req = store.get(storeId);

      req.onsuccess = () => {
        if (req.result) {
          resolve({
            lastServerVersion: req.result.lastServerVersion || 0,
            lastSyncedAt: req.result.lastSyncedAt || null,
          });
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
