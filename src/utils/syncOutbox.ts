import { generateUuidV7, createPrefixedId } from './uuid';
import type {
  SyncOutboxEvent,
  SyncEntityType,
  SyncMutationType,
  SyncBatchPushPayload,
  SyncBatchPushResult,
  SyncPullResult,
} from '../types';
import {
  idbSaveEvent,
  idbGetEvents,
  idbDeleteEvents,
  idbUpdateEventStatus,
  idbGetMeta,
  idbSetMeta,
} from './idbStorage';
import { getApiUrl, getAuthHeaders } from './apiClient';

export interface SyncEngineStatus {
  isSyncing: boolean;
  pendingCount: number;
  lastSyncedAt: string | null;
  lastServerVersion: number;
  isOnline: boolean;
  lastError?: string;
  storageType?: 'IndexedDB' | 'localStorage';
}

export interface RemoteLockNotice {
  isLocked: boolean;
  reason?: string;
}

type SyncStateListener = (status: SyncEngineStatus) => void;
type DeltasCallback = (deltas: NonNullable<SyncPullResult['deltas']>, serverVersion: number) => void;
type RemoteLockListener = (notice: RemoteLockNotice) => void;

const OUTBOX_KEY_PREFIX = 'smartsales_pos_sync_outbox_';
const SYNC_META_KEY_PREFIX = 'smartsales_pos_sync_meta_';
const TERMINAL_ID_KEY = 'smartsales_pos_terminal_id';
const APP_VERSION = '2.4.0';

// In-Memory cache of outbox events per store for instant non-blocking UI access
const outboxMemoryCache = new Map<string, SyncOutboxEvent[]>();
const memoryInitializedStores = new Set<string>();

const remoteLockListeners: RemoteLockListener[] = [];

/**
 * Get or initialize a unique persistent POS Terminal ID for this device
 */
export function getPersistentTerminalId(storeId: string = 'store_default'): string {
  try {
    const existing = localStorage.getItem(TERMINAL_ID_KEY);
    if (existing && existing.trim()) {
      return existing.trim();
    }
    const newId = createPrefixedId.terminal(storeId);
    localStorage.setItem(TERMINAL_ID_KEY, newId);
    return newId;
  } catch {
    return `TERM_${storeId}_OFFLINE_${Date.now().toString(36)}`;
  }
}

/**
 * Initialize outbox storage from IndexedDB (with localStorage fallback)
 */
export async function initOutboxStorage(storeId: string = 'store_default'): Promise<void> {
  if (memoryInitializedStores.has(storeId)) return;

  try {
    // 1. Try reading from IndexedDB
    const idbEvents = await idbGetEvents(storeId);
    if (idbEvents && idbEvents.length > 0) {
      outboxMemoryCache.set(storeId, idbEvents);
      memoryInitializedStores.add(storeId);
      notifyListeners(storeId);
      return;
    }

    // 2. Fallback to localStorage migration if IndexedDB empty
    const rawLocal = localStorage.getItem(`${OUTBOX_KEY_PREFIX}${storeId}`);
    if (rawLocal) {
      const localEvents: SyncOutboxEvent[] = JSON.parse(rawLocal);
      outboxMemoryCache.set(storeId, localEvents);
      // Migrate to IndexedDB asynchronously
      for (const ev of localEvents) {
        idbSaveEvent(ev).catch(() => {});
      }
    } else {
      outboxMemoryCache.set(storeId, []);
    }
  } catch (err) {
    console.warn(`[SYNC] Failed to initialize outbox storage for ${storeId}:`, err);
    outboxMemoryCache.set(storeId, []);
  } finally {
    memoryInitializedStores.add(storeId);
    notifyListeners(storeId);
  }
}

/**
 * Retrieve raw stored outbox events for a given store.
 * Synchronously reads from memory cache, with fallback to localStorage.
 */
export function getOutboxEvents(storeId: string = 'store_default'): SyncOutboxEvent[] {
  if (outboxMemoryCache.has(storeId)) {
    return outboxMemoryCache.get(storeId)!;
  }

  // Fallback to synchronous localStorage read if memory cache not yet primed
  try {
    const raw = localStorage.getItem(`${OUTBOX_KEY_PREFIX}${storeId}`);
    if (raw) {
      const events: SyncOutboxEvent[] = JSON.parse(raw);
      outboxMemoryCache.set(storeId, events);
      return events;
    }
  } catch (err) {
    console.warn(`[SYNC] Failed to read outbox for store ${storeId}:`, err);
  }

  // Trigger background initialization
  initOutboxStorage(storeId);
  return [];
}

/**
 * Persist outbox events for a given store to both in-memory cache,
 * IndexedDB, and localStorage (capped to prevent 5MB browser quota overflow)
 */
function saveOutboxEvents(storeId: string, events: SyncOutboxEvent[]): void {
  // Update in-memory cache immediately
  outboxMemoryCache.set(storeId, events);

  // Asynchronously mirror to localStorage (capped at 50 events for quick boot)
  try {
    const trimmed = events.slice(-50);
    localStorage.setItem(`${OUTBOX_KEY_PREFIX}${storeId}`, JSON.stringify(trimmed));
  } catch (err) {
    console.warn(`[SYNC] LocalStorage quota reached, IndexedDB is active:`, err);
  }
}

/**
 * Get current sync metadata for a store (last known server version, last synced timestamp)
 */
export function getSyncMeta(storeId: string = 'store_default'): { lastServerVersion: number; lastSyncedAt: string | null } {
  try {
    const raw = localStorage.getItem(`${SYNC_META_KEY_PREFIX}${storeId}`);
    if (!raw) return { lastServerVersion: 0, lastSyncedAt: null };
    return JSON.parse(raw);
  } catch {
    return { lastServerVersion: 0, lastSyncedAt: null };
  }
}

/**
 * Update sync metadata for a store
 */
export function setSyncMeta(storeId: string, meta: { lastServerVersion: number; lastSyncedAt: string | null }): void {
  try {
    localStorage.setItem(`${SYNC_META_KEY_PREFIX}${storeId}`, JSON.stringify(meta));
  } catch { }

  // Mirror to IndexedDB
  idbSetMeta(storeId, meta).catch(() => {});
}

/**
 * Enqueue a new mutation into the local outbox queue atomically.
 * Called immediately whenever a sale, refund, or record mutation is executed.
 */
export function enqueueOutboxMutation(params: {
  store_id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  mutation_type?: SyncMutationType;
  payload: any;
  client_version?: number;
}): SyncOutboxEvent {
  const storeId = params.store_id || 'store_default';
  const terminalId = getPersistentTerminalId(storeId);
  const now = new Date().toISOString();

  // Ensure payload carries store_id
  if (params.payload && typeof params.payload === 'object') {
    params.payload.store_id = storeId;
  }

  const newEvent: SyncOutboxEvent = {
    event_id: generateUuidV7(),
    store_id: storeId,
    terminal_id: terminalId,
    entity_type: params.entity_type,
    entity_id: params.entity_id,
    mutation_type: params.mutation_type || 'INSERT',
    payload: params.payload,
    client_timestamp: now,
    status: 'PENDING',
    retry_count: 0,
    client_version: params.client_version || 0,
    created_at: now,
  };

  const currentEvents = [...getOutboxEvents(storeId), newEvent];
  saveOutboxEvents(storeId, currentEvents);

  // Persist to high-capacity IndexedDB asynchronously
  idbSaveEvent(newEvent).catch((err) => {
    console.warn('[SYNC] Error persisting event to IndexedDB:', err);
  });

  notifyListeners(storeId);

  // Trigger non-blocking push if online
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    scheduleDebouncedSync(storeId);
  }

  return newEvent;
}

/**
 * Get all pending events awaiting synchronization
 */
export function getPendingOutboxEvents(storeId: string = 'store_default'): SyncOutboxEvent[] {
  return getOutboxEvents(storeId).filter(e => e.status === 'PENDING');
}

/**
 * Mark events as completed (prunes synced events to keep storage lean)
 */
export function markOutboxEventsSynced(storeId: string, processedIds: string[]): void {
  if (!processedIds.length) return;
  const processedSet = new Set(processedIds);
  const events = getOutboxEvents(storeId);

  // Filter out processed events, keeping un-synced or failed ones
  const remaining = events.filter(e => !processedSet.has(e.event_id));
  saveOutboxEvents(storeId, remaining);

  // Delete from IndexedDB asynchronously
  idbDeleteEvents(processedIds).catch(() => {});

  notifyListeners(storeId);
}

/**
 * Mark events as rejected/failed with error reason
 */
export function markOutboxEventsFailed(storeId: string, rejected: { event_id: string; reason: string }[]): void {
  if (!rejected.length) return;
  const rejectedMap = new Map(rejected.map(r => [r.event_id, r.reason]));
  const events = getOutboxEvents(storeId);

  const updatesForIdb: Array<{ event_id: string; status: 'FAILED'; retry_count: number; last_error?: string }> = [];

  for (const ev of events) {
    if (rejectedMap.has(ev.event_id)) {
      ev.status = 'FAILED';
      ev.retry_count = (ev.retry_count || 0) + 1;
      ev.last_error = rejectedMap.get(ev.event_id);
      updatesForIdb.push({
        event_id: ev.event_id,
        status: 'FAILED',
        retry_count: ev.retry_count,
        last_error: ev.last_error,
      });
    }
  }

  saveOutboxEvents(storeId, events);

  // Update in IndexedDB
  idbUpdateEventStatus(updatesForIdb).catch(() => {});

  notifyListeners(storeId);
}

// -------------------------------------------------------------
// PUSH & PULL SYNC PROTOCOL
// -------------------------------------------------------------

let isSyncingMap: Record<string, boolean> = {};
const listeners: SyncStateListener[] = [];
let onDeltasReceivedCallback: DeltasCallback | null = null;

function notifyListeners(storeId: string, error?: string): void {
  const pending = getPendingOutboxEvents(storeId).length;
  const meta = getSyncMeta(storeId);
  const status: SyncEngineStatus = {
    isSyncing: Boolean(isSyncingMap[storeId]),
    pendingCount: pending,
    lastSyncedAt: meta.lastSyncedAt,
    lastServerVersion: meta.lastServerVersion,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    lastError: error,
    storageType: typeof window !== 'undefined' && Boolean(window.indexedDB) ? 'IndexedDB' : 'localStorage',
  };

  for (const listener of listeners) {
    try {
      listener(status);
    } catch { }
  }
}

/**
 * Push all pending outbox events to the server in a single atomic batch
 */
export async function pushOutboxBatch(storeId: string = 'store_default'): Promise<SyncBatchPushResult> {
  const pending = getPendingOutboxEvents(storeId);
  if (pending.length === 0) {
    const meta = getSyncMeta(storeId);
    return {
      success: true,
      processed_event_ids: [],
      server_version: meta.lastServerVersion,
      synced_at: new Date().toISOString(),
    };
  }

  const payload: SyncBatchPushPayload = {
    store_id: storeId,
    terminal_id: getPersistentTerminalId(storeId),
    events: pending,
  };

  const response = await fetch(getApiUrl('/api/v1/sync/push'), {
    method: 'POST',
    headers: getAuthHeaders(storeId),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sync push HTTP ${response.status}: ${errorText}`);
  }

  const result: SyncBatchPushResult = await response.json();

  if (result.success) {
    if (result.processed_event_ids?.length) {
      markOutboxEventsSynced(storeId, result.processed_event_ids);
    }
    if (result.rejected_event_ids?.length) {
      markOutboxEventsFailed(storeId, result.rejected_event_ids);
    }
    setSyncMeta(storeId, {
      lastServerVersion: result.server_version,
      lastSyncedAt: result.synced_at || new Date().toISOString(),
    });
  }

  return result;
}

/**
 * Pull deltas from the server since the last recorded server version
 */
export async function pullServerDeltas(storeId: string = 'store_default', sinceVersion?: number): Promise<SyncPullResult> {
  const meta = getSyncMeta(storeId);
  const version = typeof sinceVersion === 'number' ? sinceVersion : meta.lastServerVersion;

  const response = await fetch(getApiUrl(`/api/v1/sync/pull?since_version=${version}`), {
    headers: getAuthHeaders(storeId),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Sync pull HTTP ${response.status}: ${errorText}`);
  }

  const result: SyncPullResult = await response.json();
  if (result.success && !result.up_to_date && result.current_version > version) {
    setSyncMeta(storeId, {
      lastServerVersion: result.current_version,
      lastSyncedAt: new Date().toISOString(),
    });
  }

  return result;
}

/**
 * Perform a full bi-directional synchronization cycle (Push outbox -> Pull server deltas)
 */
export async function executeFullSyncCycle(
  storeId: string = 'store_default',
  onDeltas?: DeltasCallback
): Promise<{ pushedCount: number; deltasPulled: boolean; serverVersion: number }> {
  if (isSyncingMap[storeId]) {
    return { pushedCount: 0, deltasPulled: false, serverVersion: getSyncMeta(storeId).lastServerVersion };
  }

  isSyncingMap[storeId] = true;
  notifyListeners(storeId);

  let pushedCount = 0;
  let deltasPulled = false;
  let serverVersion = getSyncMeta(storeId).lastServerVersion;

  try {
    // 1. Push Outbox Events
    const pushResult = await pushOutboxBatch(storeId);
    if (pushResult.success) {
      pushedCount = pushResult.processed_event_ids.length;
      serverVersion = pushResult.server_version;
    }

    // 2. Pull Server Deltas
    const pullResult = await pullServerDeltas(storeId, serverVersion);
    if (pullResult.success && !pullResult.up_to_date && pullResult.deltas) {
      deltasPulled = true;
      serverVersion = pullResult.current_version;
      const callback = onDeltas || onDeltasReceivedCallback;
      if (callback) {
        callback(pullResult.deltas, serverVersion);
      }
    }

    notifyListeners(storeId);
    return { pushedCount, deltasPulled, serverVersion };
  } catch (err: any) {
    console.warn(`[SYNC] Full sync cycle error for store ${storeId}:`, err.message);
    notifyListeners(storeId, err.message);
    throw err;
  } finally {
    isSyncingMap[storeId] = false;
    notifyListeners(storeId);
  }
}

// -------------------------------------------------------------
// TERMINAL FLEET HEARTBEAT & REMOTE LOCK TELEMETRY
// -------------------------------------------------------------

/**
 * Send terminal status telemetry and check remote lock enforcement
 */
export async function sendTerminalHeartbeat(
  storeId: string = 'store_default',
  terminalName?: string
): Promise<{ is_locked: boolean; lock_reason?: string }> {
  try {
    const terminalId = getPersistentTerminalId(storeId);
    const pendingCount = getPendingOutboxEvents(storeId).length;

    const res = await fetch(getApiUrl('/api/v1/terminals/heartbeat'), {
      method: 'POST',
      headers: getAuthHeaders(storeId),
      body: JSON.stringify({
        terminal_id: terminalId,
        store_id: storeId,
        terminal_name: terminalName || `Terminal (${terminalId.slice(-6)})`,
        app_version: APP_VERSION,
        pending_outbox_count: pendingCount,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.is_locked) {
        notifyRemoteLock({ isLocked: true, reason: data.lock_reason });
      }
      return { is_locked: Boolean(data.is_locked), lock_reason: data.lock_reason };
    }
  } catch (err) {
    // Non-blocking in offline state
  }

  return { is_locked: false };
}

/**
 * Register listener for remote lock enforcement events
 */
export function subscribeRemoteLock(listener: RemoteLockListener): () => void {
  remoteLockListeners.push(listener);
  return () => {
    const idx = remoteLockListeners.indexOf(listener);
    if (idx !== -1) remoteLockListeners.splice(idx, 1);
  };
}

function notifyRemoteLock(notice: RemoteLockNotice): void {
  for (const listener of remoteLockListeners) {
    try {
      listener(notice);
    } catch { }
  }
}

// Debounced sync trigger
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDebouncedSync(storeId: string) {
  if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    executeFullSyncCycle(storeId).catch(() => { });
  }, 1000);
}

/**
 * Initialize background sync engine with automatic network reconnect triggers,
 * IndexedDB hydration, and periodic heartbeat polling.
 */
export function initBackgroundSyncEngine(
  storeId: string = 'store_default',
  onDeltas?: DeltasCallback,
  syncIntervalMs: number = 15000
): () => void {
  onDeltasReceivedCallback = onDeltas || null;

  // Initialize high-capacity IndexedDB storage on engine boot
  initOutboxStorage(storeId).catch(() => {});

  const handleOnline = () => {
    console.log(`[SYNC] Internet connection restored. Triggering outbox flush for ${storeId}...`);
    executeFullSyncCycle(storeId, onDeltas).catch(() => { });
    sendTerminalHeartbeat(storeId).catch(() => {});
  };

  const handleOffline = () => {
    console.log('[SYNC] Device transitioned to offline mode. Mutations will queue in local IndexedDB outbox.');
    notifyListeners(storeId);
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
  }

  // Periodic heartbeat & sync cycle
  const interval = setInterval(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    executeFullSyncCycle(storeId, onDeltas).catch(() => { });
    sendTerminalHeartbeat(storeId).catch(() => {});
  }, syncIntervalMs);

  // Initial cycle & heartbeat
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    executeFullSyncCycle(storeId, onDeltas).catch(() => { });
    sendTerminalHeartbeat(storeId).catch(() => {});
  }

  // Cleanup function
  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    }
    clearInterval(interval);
  };
}

/**
 * Subscribe to sync engine status updates (for reactive badges & UI widgets)
 */
export function subscribeSyncStatus(listener: SyncStateListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}
