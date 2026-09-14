import { expect, test } from "bun:test";
import { isCloudPanelDormant } from "./panel-visibility.ts";

const idle = {
  embedded: true,
  expanded: false,
  status: "idle" as const,
  docId: null,
  recoveryCount: 0,
  error: null,
  notice: null,
  busy: false,
};

test("only dormant embedded cloud chrome is hidden", () => {
  expect(isCloudPanelDormant(idle)).toBe(true);
  expect(isCloudPanelDormant({ ...idle, status: "closed" })).toBe(true);
  expect(isCloudPanelDormant({ ...idle, embedded: false })).toBe(false);
  expect(isCloudPanelDormant({ ...idle, expanded: true })).toBe(false);
});

test("connection, recovery, error and operation feedback remain visible", () => {
  for (const status of [
    "connecting",
    "syncing",
    "connected",
    "reconnecting",
    "error",
  ] as const) {
    expect(isCloudPanelDormant({ ...idle, status })).toBe(false);
  }
  for (const state of [
    { ...idle, recoveryCount: 1 },
    { ...idle, error: "Failed" },
    { ...idle, notice: "Download failed" },
    { ...idle, docId: "doc-1" },
    { ...idle, busy: true },
  ])
    expect(isCloudPanelDormant(state)).toBe(false);
});
