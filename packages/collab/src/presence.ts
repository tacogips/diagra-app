// Presence over the provider's awareness channel (design 6).
//
// Presence is not document data: it never enters the Y.Doc and is never
// persisted (design 7.1). Awareness state is per-connection and disappears
// with the socket, which is exactly the lifetime a cursor should have.

import type { ElementId, PageId } from "@diagra/ir";
import type { Awareness } from "y-protocols/awareness";

export interface PresenceUser {
  readonly name: string;
  /** Any CSS colour; the desktop stores one per install. */
  readonly color: string;
}

export interface PresenceState {
  readonly user: PresenceUser;
  /** Page-space pointer position, or `null` when the pointer left. */
  readonly cursor: { readonly x: number; readonly y: number } | null;
  readonly selection: readonly ElementId[];
  readonly page: PageId;
  /**
   * Page-space marquee rectangle while this user is brush-selecting, or
   * `null`/absent otherwise. Ephemeral like the cursor: it exists only for
   * the duration of the drag.
   */
  readonly brush?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  } | null;
}

export interface PresencePeer {
  readonly clientId: number;
  readonly state: PresenceState;
}

export type PresenceListener = (peers: readonly PresencePeer[]) => void;

/** Publish this client's state. Replaces the previous state wholesale. */
export function publishPresence(
  awareness: Awareness,
  state: PresenceState,
): void {
  awareness.setLocalState(state as unknown as Record<string, unknown>);
}

/** Drop this client's state without waiting for the 30 s awareness timeout. */
export function clearPresence(awareness: Awareness): void {
  awareness.setLocalState(null);
}

function isPresenceState(value: unknown): value is PresenceState {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const state = value as Record<string, unknown>;
  const user = state.user as Record<string, unknown> | undefined;
  return (
    typeof user === "object" &&
    user !== null &&
    typeof user.name === "string" &&
    typeof user.color === "string" &&
    typeof state.page === "string" &&
    Array.isArray(state.selection)
  );
}

/** Every peer except this client, newest state first delivered on change. */
export function readPeers(awareness: Awareness): readonly PresencePeer[] {
  const peers: PresencePeer[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    // A peer running a different build may publish anything at all; an
    // overlay that trusted it would crash the canvas for everyone.
    if (clientId !== awareness.clientID && isPresenceState(state)) {
      peers.push({ clientId, state });
    }
  }
  return peers.sort((left, right) => left.clientId - right.clientId);
}

/**
 * Subscribe to remote presence. The listener is called once immediately with
 * whoever is already there, then on every awareness change.
 */
export function observePresence(
  awareness: Awareness,
  listener: PresenceListener,
): () => void {
  const onChange = (): void => {
    listener(readPeers(awareness));
  };
  awareness.on("change", onChange);
  onChange();
  return () => {
    awareness.off("change", onChange);
  };
}
