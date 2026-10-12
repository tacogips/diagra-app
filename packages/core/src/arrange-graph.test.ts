import { describe, expect, test } from "bun:test";
import {
  type LayoutNode,
  layeredLayout,
  placeInOrder,
  separateOverlaps,
} from "./arrange-graph.ts";

function node(id: string, x = 0, y = 0, width = 100, height = 60): LayoutNode {
  return { id, x, y, width, height };
}

function overlaps(
  boxes: readonly { x: number; y: number; width: number; height: number }[],
): boolean {
  return boxes.some((a, i) =>
    boxes.some(
      (b, j) =>
        i < j &&
        a.x < b.x + b.width &&
        b.x < a.x + a.width &&
        a.y < b.y + b.height &&
        b.y < a.y + a.height,
    ),
  );
}

describe("placeInOrder", () => {
  test("keeps desired positions that already respect the spacing", () => {
    expect(placeInOrder([0, 200], [100, 100], 20)).toEqual([0, 200]);
  });

  test("pools violators around their mean without reordering", () => {
    expect(placeInOrder([50, 50], [100, 100], 20)).toEqual([-10, 110]);
  });
});

describe("layeredLayout", () => {
  test("places referenced boxes before referencing ones, left to right", () => {
    const nodes = [
      node("child", 0, 0),
      node("parent", 0, 0),
      node("leaf", 0, 0),
    ];
    const out = layeredLayout(nodes, [
      { from: "parent", to: "child" },
      { from: "child", to: "leaf" },
    ]);
    const x = (id: string) => out.get(id)?.x ?? Number.NaN;
    expect(x("parent")).toBeLessThan(x("child"));
    expect(x("child")).toBeLessThan(x("leaf"));
    expect(out.get("parent")?.y).toBe(out.get("child")?.y);
  });

  test("top to bottom flows along y", () => {
    const out = layeredLayout(
      [node("a"), node("b")],
      [{ from: "a", to: "b" }],
      { direction: "TB" },
    );
    expect(out.get("a")?.y).toBeLessThan(out.get("b")?.y ?? 0);
    expect(out.get("a")?.x).toBe(out.get("b")?.x);
  });

  test("never overlaps boxes, survives cycles and is deterministic", () => {
    const nodes = Array.from({ length: 12 }, (_, i) =>
      node(
        `n${i}`,
        (i * 37) % 200,
        (i * 53) % 150,
        80 + (i % 3) * 40,
        40 + (i % 4) * 30,
      ),
    );
    const edges = [
      { from: "n0", to: "n1" },
      { from: "n1", to: "n2" },
      { from: "n2", to: "n0" },
      { from: "n0", to: "n3" },
      { from: "n0", to: "n4" },
      { from: "n4", to: "n5" },
      { from: "n6", to: "n7" },
    ];
    const first = layeredLayout(nodes, edges);
    const placed = nodes.map((n) => ({
      ...(first.get(n.id) ?? { x: 0, y: 0 }),
      width: n.width,
      height: n.height,
    }));
    expect(overlaps(placed)).toBe(false);
    expect(layeredLayout([...nodes].reverse(), [...edges].reverse())).toEqual(
      first,
    );
  });
});

describe("separateOverlaps", () => {
  test("moves later boxes the shortest way and leaves fixed boxes alone", () => {
    const out = separateOverlaps(
      [
        { ...node("a", 0, 0), fixed: true },
        node("b", 90, 10),
        node("c", 500, 500),
      ],
      20,
    );
    expect(out.get("a")).toEqual({ x: 0, y: 0 });
    expect(out.get("b")).toEqual({ x: 120, y: 10 });
    expect(out.get("c")).toEqual({ x: 500, y: 500 });
  });

  test("untangles a pile of identical boxes", () => {
    const pile = Array.from({ length: 9 }, (_, i) => node(`p${i}`, 10, 10));
    const out = separateOverlaps(pile, 10);
    expect(
      overlaps(
        pile.map((n) => ({
          ...(out.get(n.id) as { x: number; y: number }),
          width: n.width,
          height: n.height,
        })),
      ),
    ).toBe(false);
  });
});
