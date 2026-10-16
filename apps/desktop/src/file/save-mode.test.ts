import { expect, test } from "bun:test";
import { loadSaveMode, storeSaveMode } from "./save-mode.ts";

test("saving preference defaults to automatic and persists manual", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  expect(loadSaveMode(storage)).toBe("automatic");
  storeSaveMode("manual", storage);
  expect(loadSaveMode(storage)).toBe("manual");
  storeSaveMode("automatic", storage);
  expect(loadSaveMode(storage)).toBe("automatic");
  storage.setItem("nodetto.file.save-mode", "invalid");
  expect(loadSaveMode(storage)).toBe("automatic");
});

test("unavailable preferences never prevent file saving", () => {
  const storage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  expect(loadSaveMode(storage)).toBe("automatic");
  expect(() => storeSaveMode("manual", storage)).not.toThrow();
});
