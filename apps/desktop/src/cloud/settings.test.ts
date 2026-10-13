import { expect, test } from "bun:test";
import { loadCloudSettings, saveCloudSettings } from "./settings.ts";

test("Nodetto reads legacy cloud settings and saves under its new name", () => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  const legacy = {
    endpointUrl: "https://example.com",
    userName: "Alice",
    userColor: "#335c67",
  };
  storage.setItem("diagra.cloud.settings", JSON.stringify(legacy));
  expect(loadCloudSettings(storage)).toEqual(legacy);
  const current = { ...legacy, userName: "Bob" };
  saveCloudSettings(current, storage);
  expect(loadCloudSettings(storage)).toEqual(current);
  expect(storage.getItem("nodetto.cloud.settings")).toBe(
    JSON.stringify(current),
  );
  expect(storage.getItem("diagra.cloud.settings")).toBe(JSON.stringify(legacy));
});
