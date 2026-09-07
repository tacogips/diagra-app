import { expect, test } from "bun:test";
import { rulerTicks } from "./CanvasRulers.tsx";

test("ruler ticks stay screen-readable while tracking camera pan and zoom", () => {
  const normal = rulerTicks(0, 1, 240);
  expect(normal.filter((tick) => tick.major).map((tick) => tick.value)).toEqual(
    [0, 50, 100, 150, 200],
  );
  expect(normal).toHaveLength(25);

  const zoomed = rulerTicks(-100, 2, 240);
  expect(zoomed[0]?.value).toBe(100);
  expect(zoomed[0]?.screen).toBe(0);
  expect(zoomed.filter((tick) => tick.major).map((tick) => tick.value)).toEqual(
    [100, 150, 200],
  );
  expect(rulerTicks(0, 0, 100)).toEqual([]);
});
