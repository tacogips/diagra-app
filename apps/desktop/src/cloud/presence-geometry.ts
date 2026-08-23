// Screen-space geometry for remote selections.
//
// A peer's awareness state names the elements it currently manipulates
// (`selection`). This module turns that into screen rectangles the overlay
// can draw, using the same camera equation as the cursors:
// `screen = (page + camera) * zoom`. Pure so the projection and labelling
// rules are testable without a DOM.

import type { Box } from "@diagra/core";
import type { ElementId, PageId } from "@diagra/ir";
import type { PresencePeer } from "@diagra/collab";

export interface CameraLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PeerSelectionBox {
  readonly clientId: number;
  readonly name: string;
  readonly color: string;
  readonly rect: ScreenRect;
  /** Only the first few rects per peer carry the name tag. */
  readonly labeled: boolean;
}

/** Large multi-selections outline everything but tag only the first few. */
export const MAX_LABELED_PER_PEER = 4;

export function peerSelectionBoxes(
  peers: readonly PresencePeer[],
  page: PageId,
  boundsOf: (id: ElementId) => Box | null,
  camera: CameraLike,
): readonly PeerSelectionBox[] {
  const out: PeerSelectionBox[] = [];
  for (const peer of peers) {
    if (peer.state.page !== page) {
      continue;
    }
    let labeled = 0;
    for (const id of peer.state.selection) {
      const box = boundsOf(id);
      if (!box) {
        continue;
      }
      out.push({
        clientId: peer.clientId,
        name: peer.state.user.name,
        color: peer.state.user.color,
        rect: {
          x: (box.x + camera.x) * camera.z,
          y: (box.y + camera.y) * camera.z,
          width: box.width * camera.z,
          height: box.height * camera.z,
        },
        labeled: labeled++ < MAX_LABELED_PER_PEER,
      });
    }
  }
  return out;
}
