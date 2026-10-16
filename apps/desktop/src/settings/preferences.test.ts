import { expect, test } from "bun:test";
import {
  loadEditorPreferences,
  storeEditorPreferences,
} from "./preferences.ts";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}
test("canvas and snapping preferences survive reload and migrate the ruler setting", () => {
  const store = storage();
  store.setItem("nodetto.view.show-rulers", "false");
  expect(loadEditorPreferences(store).showRulers).toBe(false);
  const preferences = {
    ...loadEditorPreferences(store),
    showGrid: false,
    leftPaneOpen: false,
    rightPaneOpen: false,
    autosaveDelayMs: 3000,
    snap: { grid: false, objects: false, guides: false },
  };
  storeEditorPreferences(preferences, store);
  expect(loadEditorPreferences(store)).toEqual(preferences);
});
test("malformed or unavailable preference storage cannot break editing", () => {
  const store = storage();
  store.setItem("nodetto.editor.preferences.v1", "broken");
  expect(loadEditorPreferences(store).autosaveDelayMs).toBe(1000);
  store.setItem(
    "nodetto.editor.preferences.v1",
    JSON.stringify({
      showGrid: "false",
      showRulers: false,
      autosaveDelayMs: -1,
      snap: { grid: "no", guides: false },
    }),
  );
  const preferences = loadEditorPreferences(store);
  expect(preferences.showGrid).toBe(true);
  expect(preferences.showRulers).toBe(false);
  expect(preferences.autosaveDelayMs).toBe(1000);
  expect(preferences.snap).toEqual({
    grid: true,
    objects: true,
    guides: false,
  });
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  expect(loadEditorPreferences(blocked).showGrid).toBe(true);
  expect(() => storeEditorPreferences(preferences, blocked)).not.toThrow();
});
