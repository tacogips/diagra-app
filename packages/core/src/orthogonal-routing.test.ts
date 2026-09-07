import { describe, expect, test } from "bun:test";
import type { Box, Vec } from "./geometry.ts";
import { avoidOrthogonalObstacles } from "./orthogonal-routing.ts";

function crossesInterior(from: Vec, to: Vec, box: Box): boolean {
  if (from.y === to.y)
    return (
      from.y > box.y &&
      from.y < box.y + box.height &&
      Math.max(from.x, to.x) > box.x &&
      Math.min(from.x, to.x) < box.x + box.width
    );
  return (
    from.x > box.x &&
    from.x < box.x + box.width &&
    Math.max(from.y, to.y) > box.y &&
    Math.min(from.y, to.y) < box.y + box.height
  );
}

describe("orthogonal obstacle routing", () => {
  const preferred = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 100 },
    { x: 100, y: 100 },
  ] as const;

  test("returns the preferred bend unchanged when every segment is clear", () => {
    expect(
      avoidOrthogonalObstacles(
        preferred,
        [{ x: 10, y: 20, width: 20, height: 20 }],
        "h",
      ),
    ).toBe(preferred);
  });

  test("finds a deterministic clearance path around a blocking layer", () => {
    const obstacle = { x: 40, y: 20, width: 20, height: 60 };
    const route = avoidOrthogonalObstacles(preferred, [obstacle], "h");
    expect(route).not.toEqual(preferred);
    expect(route[0]).toEqual(preferred[0]);
    expect(route.at(-1)).toEqual(preferred.at(-1));
    expect(route[1]?.y).toBe(0);
    expect(route.at(-2)?.y).toBe(100);
    expect(
      route
        .slice(1)
        .some((point, index) =>
          crossesInterior(route[index] as Vec, point, obstacle),
        ),
    ).toBe(false);
    expect(avoidOrthogonalObstacles(preferred, [obstacle], "h")).toEqual(route);
  });

  test("incorporates a second obstacle encountered by the first detour", () => {
    const obstacles = [
      { x: 40, y: 20, width: 20, height: 60 },
      { x: 20, y: 75, width: 20, height: 20 },
    ];
    const route = avoidOrthogonalObstacles(preferred, obstacles, "h");
    for (const obstacle of obstacles)
      expect(
        route
          .slice(1)
          .some((point, index) =>
            crossesInterior(route[index] as Vec, point, obstacle),
          ),
      ).toBe(false);
  });
});
