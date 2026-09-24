/**
 * Change notifications for the local database. Writers call `notifyChange`; the UI (and the search
 * worker) subscribe. Notifications cross tabs and workers via BroadcastChannel, so an import running
 * in a worker updates the journal live.
 */

export interface ChangeEvent {
  stores: string[];
  /** Conversations whose source or derived data changed (lets search re-index incrementally). */
  conversationIds?: string[];
  /** Everything may have changed (sample load, delete-all). */
  reset?: boolean;
}

type Listener = (e: ChangeEvent) => void;

const CHANNEL_NAME = 'cj:db-changes';
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (msg: MessageEvent<ChangeEvent>) => dispatch(msg.data);
    // Node keeps the process alive while a channel is open; browsers ignore unref.
    (channel as unknown as { unref?: () => void }).unref?.();
  } catch {
    channel = null;
  }
  return channel;
}

function dispatch(e: ChangeEvent) {
  for (const fn of Array.from(listeners)) {
    try {
      fn(e);
    } catch (err) {
      console.error('change listener failed', err);
    }
  }
}

let broadcastEnabled = true;

/** In-memory storage mode keeps data per-context, so cross-context broadcasts would be misleading. */
export function setBroadcastEnabled(enabled: boolean) {
  broadcastEnabled = enabled;
}

export function notifyChange(e: ChangeEvent): void {
  queueMicrotask(() => dispatch(e));
  if (broadcastEnabled) getChannel()?.postMessage(e);
}

export function subscribeChanges(fn: Listener): () => void {
  if (broadcastEnabled) getChannel();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function closeChangeChannel(): void {
  channel?.close();
  channel = null;
}
