import { describe, expect, test } from "bun:test";

import type { Box } from "@diagra/core";
import type { ElementId, PageId } from "@diagra/ir";
import type { PresencePeer, PresenceState } from "@diagra/collab";

import {
  MAX_LABELED_PER_PEER,
  peerBrushes,
  peerSelectionBoxes,
  projectRect,
} from "./presence-geometry.ts";

const PAGE = "p1" as PageId;

function peer(
  clientId: number,
  state: Partial<PresenceState> & { selection: readonly ElementId[] },
): PresencePeer {
  return {
    clientId,
    state: {
      user: { name: `user-${clientId}`, color: "#a05a2c" },
      cursor: null,
      page: PAGE,
      ...state,
    },
  };
}

const BOUNDS: Record<string, Box> = {
  a: { x: 10, y: 20, width: 100, height: 50 },
  b: { x: -5, y: 0, width: 30, height: 30 },
};

const boundsOf = (id: ElementId): Box | null => BOUNDS[id as string] ?? null;

describe("peerSelectionBoxes", () => {
  test("projects page bounds through the camera equation", () => {
    const out = peerSelectionBoxes(
      [peer(1, { selection: ["a" as ElementId] })],
      PAGE,
      boundsOf,
      { x: 100, y: -10, z: 2 },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.rect).toEqual({ x: 220, y: 20, width: 200, height: 100 });
    expect(out[0]?.name).toBe("user-1");
    expect(out[0]?.labeled).toBe(true);
  });

  test("skips peers on another page and ids without bounds", () => {
    const out = peerSelectionBoxes(
      [
        peer(1, { page: "p2" as PageId, selection: ["a" as ElementId] }),
        peer(2, { selection: ["missing" as ElementId, "b" as ElementId] }),
      ],
      PAGE,
      boundsOf,
      { x: 0, y: 0, z: 1 },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.clientId).toBe(2);
    expect(out[0]?.rect).toEqual({ x: -5, y: 0, width: 30, height: 30 });
  });

  test("selection outlines do not require a live cursor", () => {
    const out = peerSelectionBoxes(
      [peer(1, { cursor: null, selection: ["a" as ElementId] })],
      PAGE,
      boundsOf,
      { x: 0, y: 0, z: 1 },
    );
    expect(out).toHaveLength(1);
  });

  test("caps name tags per peer but outlines everything", () => {
    const many = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [
        `e${i}`,
        { x: i, y: 0, width: 1, height: 1 },
      ]),
    ) as Record<string, Box>;
    const out = peerSelectionBoxes(
      [
        peer(1, {
          selection: Object.keys(many).map((id) => id as ElementId),
        }),
      ],
      PAGE,
      (id) => many[id as string] ?? null,
      { x: 0, y: 0, z: 1 },
    );
    expect(out).toHaveLength(6);
    expect(out.filter((s) => s.labeled)).toHaveLength(MAX_LABELED_PER_PEER);
  });
});

describe("peerBrushes", () => {
  test("projects a brush and drops peers without one", () => {
    const out = peerBrushes(
      [
        peer(1, {
          selection: [],
          brush: { x: 10, y: 20, width: 40, height: 30 },
        }),
        peer(2, { selection: [] }),
        peer(3, { selection: [], brush: null }),
      ],
      PAGE,
      { x: 100, y: -10, z: 2 },
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.clientId).toBe(1);
    expect(out[0]?.rect).toEqual({ x: 220, y: 20, width: 80, height: 60 });
  });

  test("ignores brushes on another page", () => {
    const out = peerBrushes(
      [
        peer(1, {
          page: "p2" as PageId,
          selection: [],
          brush: { x: 0, y: 0, width: 5, height: 5 },
        }),
      ],
      PAGE,
      { x: 0, y: 0, z: 1 },
    );
    expect(out).toHaveLength(0);
  });
});

describe("projectRect", () => {
  test("matches the cursor projection equation", () => {
    expect(
      projectRect({ x: 3, y: 4, width: 10, height: 20 }, { x: 7, y: 6, z: 3 }),
    ).toEqual({ x: 30, y: 30, width: 30, height: 60 });
  });
});
