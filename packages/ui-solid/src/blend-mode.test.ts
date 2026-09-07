import { expect, test } from "bun:test";
import { layerAppearanceStyle } from "./shapes/visual.ts";

test("layer appearance maps portable blend modes to browser compositing", () => {
  expect(
    layerAppearanceStyle({ style: { opacity: 0.6, blendMode: "soft-light" } }),
  ).toMatchObject({
    opacity: 0.6,
    "mix-blend-mode": "soft-light",
  });
  expect(layerAppearanceStyle({})["mix-blend-mode"]).toBe("normal");
});
