import { expect, test } from "bun:test";
import {
  createDefaultRegistry,
  Editor,
  layerRows,
  selectLayerRow,
} from "@diagra/core";
import { layerNavigation } from "./layer-keyboard.ts";

function fixture() {
  let nextId = 0;
  const editor = new Editor({
    registry: createDefaultRegistry(),
    idSource: () => `keyboard-${String(++nextId).padStart(4, "0")}`,
  });
  const child = editor.createElement("text.note", {
    semantic: { text: "Sign in" },
  });
  const group = editor.createElement("group", {
    semantic: { memberIds: [child] },
  });
  const frame = editor.createElement("frame", {
    semantic: { name: "Screen", memberIds: [group] },
  });
  return { editor, child, group, frame };
}

test("layer keyboard traversal follows displayed order and clamps at the ends", () => {
  const { editor, child, group, frame } = fixture();
  const rows = layerRows(editor);
  const navigate = (id: string, key: string) =>
    layerNavigation(rows, id, key, new Set(), false);
  expect(navigate(frame, "ArrowDown")).toEqual({ id: group, action: "select" });
  expect(navigate(child, "ArrowUp")).toEqual({ id: group, action: "select" });
  expect(navigate(group, "Home")).toEqual({ id: frame, action: "select" });
  expect(navigate(group, "End")).toEqual({ id: child, action: "select" });
  expect(navigate(frame, "ArrowUp")).toEqual({ id: frame, action: "select" });
  expect(navigate(child, "ArrowDown")).toEqual({ id: child, action: "select" });
  expect(navigate("missing", "Home")).toBeUndefined();
  expect(navigate(frame, "Delete")).toBeUndefined();
});

test("left and right navigate parents and children or change collapse state", () => {
  const { editor, child, group, frame } = fixture();
  const rows = layerRows(editor);
  const collapsed = new Set([group]);
  const closed = layerRows(editor, collapsed);
  expect(layerNavigation(rows, group, "ArrowLeft", new Set(), false)).toEqual({
    id: group,
    action: "collapse",
  });
  expect(layerNavigation(rows, group, "ArrowRight", new Set(), false)).toEqual({
    id: child,
    action: "select",
  });
  expect(layerNavigation(rows, child, "ArrowLeft", new Set(), false)).toEqual({
    id: group,
    action: "select",
  });
  expect(
    layerNavigation(closed, group, "ArrowRight", collapsed, false),
  ).toEqual({ id: group, action: "expand" });
  expect(layerNavigation(closed, group, "ArrowLeft", collapsed, false)).toEqual(
    { id: frame, action: "select" },
  );
  expect(layerNavigation(rows, child, "ArrowRight", new Set(), false)).toEqual({
    id: child,
    action: "select",
  });
});

test("search keyboard navigation retains expanded matching paths without changing saved collapse state", () => {
  const { editor, child, group, frame } = fixture();
  const collapsed = new Set([frame, group]);
  const rows = layerRows(editor, collapsed, "Sign in");
  const before = editor.getSnapshot();
  expect(layerNavigation(rows, group, "ArrowLeft", collapsed, true)).toEqual({
    id: frame,
    action: "select",
  });
  expect(layerNavigation(rows, group, "ArrowRight", collapsed, true)).toEqual({
    id: child,
    action: "select",
  });
  expect(layerNavigation(rows, frame, "ArrowLeft", collapsed, true)).toEqual({
    id: frame,
    action: "select",
  });
  expect(collapsed).toEqual(new Set([frame, group]));
  expect(editor.getSnapshot()).toEqual(before);
});

test("keyboard ranges extend and shrink while all-page traversal respects parent and selection boundaries", () => {
  const { editor, child, group, frame } = fixture();
  const first = editor.currentPageId;
  const second = editor.createPage({ name: "Mobile" });
  const other = editor.createElement("text.note", {
    semantic: { text: "Mobile" },
  });
  editor.setCurrentPage(first);
  const rows = editor.store
    .listPages()
    .flatMap((page) => layerRows(editor, new Set(), "", page.id));
  const before = editor.getSnapshot();
  let anchor = selectLayerRow(editor, rows, frame, undefined);
  for (const [id, key, expected] of [
    [frame, "ArrowDown", [frame, group]],
    [group, "ArrowDown", [frame, group, child]],
    [child, "ArrowUp", [frame, group]],
  ] as const) {
    const next = layerNavigation(rows, id, key, new Set(), false);
    if (!next) throw new Error("missing navigation");
    anchor = selectLayerRow(editor, rows, next.id, anchor, { range: true });
    expect([...editor.selection.ids()]).toEqual([...expected]);
    expect(anchor).toBe(frame);
  }
  expect(layerNavigation(rows, child, "ArrowRight", new Set(), false)?.id).toBe(
    child,
  );
  expect(layerNavigation(rows, other, "ArrowLeft", new Set(), false)?.id).toBe(
    other,
  );
  const next = layerNavigation(rows, child, "ArrowDown", new Set(), false);
  expect(next?.id).toBe(other);
  selectLayerRow(editor, rows, other, anchor, { range: true });
  expect(editor.currentPageId).toBe(second);
  expect([...editor.selection.ids()]).toEqual([other]);
  expect(editor.getSnapshot()).toEqual(before);
});
