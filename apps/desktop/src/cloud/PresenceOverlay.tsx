// Remote cursors, drawn over the canvas.
//
// Presence is ephemeral and lives outside the document, so this overlay reads
// it from the session rather than from the editor, and it is the only piece
// of cloud UI that has to agree with the canvas's coordinate system: it
// projects page-space cursors through the same camera equation the viewport
// transform uses (`screen = (page + camera) * zoom`).
//
// Pointer events pass straight through: a cursor marker must never be a
// target, or a peer could park their pointer on top of a shape and make it
// unclickable for everyone else.

import type { Editor } from "@diagra/core";
import type { PresencePeer } from "@diagra/collab";
import { createEditorSignals } from "@diagra/ui-solid";
import { For, type JSX, Show } from "solid-js";

import {
  type PeerSelectionBox,
  peerSelectionBoxes,
} from "./presence-geometry.ts";

export interface PresenceOverlayProps {
  readonly editor: Editor;
  readonly peers: readonly PresencePeer[];
}

export function PresenceOverlay(props: PresenceOverlayProps): JSX.Element {
  const signals = createEditorSignals(props.editor);

  /** Peers whose cursor is on the page this user is looking at. */
  const visible = (): readonly PresencePeer[] => {
    // `rev` is read so a page switch re-runs this; `currentPageId` is not a
    // signal of its own.
    signals.rev();
    const page = props.editor.currentPageId;
    return props.peers.filter(
      (peer) => peer.state.page === page && peer.state.cursor !== null,
    );
  };

  /** Outlines for the elements each visible peer is manipulating. */
  const selections = (): readonly PeerSelectionBox[] => {
    // `rev` is read so element moves and edits re-run the projection.
    signals.rev();
    return peerSelectionBoxes(
      props.peers,
      props.editor.currentPageId,
      (id) => props.editor.getBounds(id),
      signals.camera(),
    );
  };

  return (
    <div class="app-presence-layer">
      <For each={selections()}>
        {(sel) => (
          <div
            class="app-presence-selection"
            style={{
              transform: `translate(${sel.rect.x}px, ${sel.rect.y}px)`,
              width: `${sel.rect.width}px`,
              height: `${sel.rect.height}px`,
              color: sel.color,
            }}
          >
            <Show when={sel.labeled}>
              <span
                class="app-presence-selection-name"
                style={{ background: sel.color }}
              >
                {sel.name}
              </span>
            </Show>
          </div>
        )}
      </For>
      <For each={visible()}>
        {(peer) => {
          const at = (): { x: number; y: number } => {
            const camera = signals.camera();
            const cursor = peer.state.cursor ?? { x: 0, y: 0 };
            return {
              x: (cursor.x + camera.x) * camera.z,
              y: (cursor.y + camera.y) * camera.z,
            };
          };
          return (
            <div
              class="app-presence-cursor"
              style={{
                transform: `translate(${at().x}px, ${at().y}px)`,
                color: peer.state.user.color,
              }}
            >
              <svg
                width="14"
                height="18"
                viewBox="0 0 14 18"
                aria-hidden="true"
              >
                <title>{peer.state.user.name}</title>
                <path
                  d="M1 1 L1 15 L5 11 L8 17 L10.5 15.8 L7.5 10 L12.5 9.5 Z"
                  fill="currentColor"
                  stroke="#fffdf8"
                  stroke-width="1"
                />
              </svg>
              <span
                class="app-presence-name"
                style={{ background: peer.state.user.color }}
              >
                {peer.state.user.name}
              </span>
            </div>
          );
        }}
      </For>
    </div>
  );
}

export interface PresenceChipProps {
  readonly peers: readonly PresencePeer[];
}

/** "3 others here" — the one presence signal that survives a page switch. */
export function PresenceChip(props: PresenceChipProps): JSX.Element {
  return (
    <Show when={props.peers.length > 0}>
      <span class="app-presence-chip">
        <For each={props.peers}>
          {(peer) => (
            <span
              class="app-presence-dot"
              style={{ background: peer.state.user.color }}
              title={peer.state.user.name}
            />
          )}
        </For>
        {props.peers.length === 1
          ? "1 other here"
          : `${props.peers.length} others here`}
      </span>
    </Show>
  );
}
