import { expect, test } from "bun:test";
import type { FrameSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { makeEditor } from "./test-helpers.ts";
import { componentOverrides } from "./component-overrides.ts";

function fixture() {
  const editor = makeEditor();
  const child = editor.buildElement("text.note", {
    semantic: { text: "Default" },
    visual: {
      x: 10,
      y: 10,
      width: 80,
      height: 30,
      style: { fill: "#ffffff", color: "#000000", fontSize: 14 },
    },
  });
  const source = editor.buildElement("frame", {
    semantic: { name: "Button", component: true, memberIds: [child.id] },
    visual: { x: 0, y: 0, width: 100, height: 60 },
  });
  editor.apply([
    { type: "createElement", element: source },
    { type: "createElement", element: child },
  ]);
  const id = editor.createComponentInstance(source.id);
  if (!id) throw new Error("missing instance");
  const target = (editor.store.get(id)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!target) throw new Error("missing child");
  return { editor, source, child, id, target };
}

test("automatic refresh preserves overrides and shares the source edit undo transaction", () => {
  const { editor, child, id, target } = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...(editor.store.get(id)?.semantic as object),
        autoRefresh: true,
      },
    },
  ]);
  editor.setText(child.id, "Automatic");
  expect(editor.getText(target)).toBe("Automatic");
  editor.undo();
  expect(editor.getText(child.id)).toBe("Default");
  expect(editor.getText(target)).toBe("Default");
  editor.redo();
  editor.setText(target, "Custom");
  editor.setText(child.id, "Another source edit");
  expect(editor.getText(target)).toBe("Custom");
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  editor.updateComponentStructure(id);
  expect((editor.store.get(id)?.semantic as FrameSemantic).autoRefresh).toBe(
    true,
  );
});

test("component refresh inherits rich marks and preserves local mark overrides", () => {
  const { editor, child, id, target } = fixture();
  editor.toggleTextMark(child.id, 0, 7, "bold");
  expect(editor.refreshComponentInstance(id)).toBe(true);
  expect(editor.store.get(target)?.semantic).toEqual({
    text: "Default",
    marks: [{ start: 0, end: 7, kind: "bold" }],
  });

  editor.toggleTextMark(target, 0, 7, "italic");
  editor.toggleTextMark(child.id, 0, 7, "code");
  expect(editor.refreshComponentInstance(id)).toBe(true);
  expect(editor.store.get(target)?.semantic).toEqual({
    text: "Default",
    marks: [
      { start: 0, end: 7, kind: "bold" },
      { start: 0, end: 7, kind: "italic" },
    ],
  });
  expect(
    componentOverrides(editor, target).map((item) => item.field),
  ).toContain("marks");
  expect(editor.resetComponentOverride(id, target, "marks")).toBe(true);
  expect(editor.store.get(target)?.semantic).toEqual({
    text: "Default",
    marks: [
      { start: 0, end: 7, kind: "bold" },
      { start: 0, end: 7, kind: "code" },
    ],
  });
});

test("automatic refresh pauses for locked contents and can be disabled", () => {
  const { editor, child, id, target } = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...(editor.store.get(id)?.semantic as object),
        autoRefresh: true,
      },
    },
  ]);
  editor.apply([
    { type: "updateVisual", id: target, visual: { locked: true } },
  ]);
  editor.setText(child.id, "While locked");
  expect(editor.getText(target)).toBe("Default");
  editor.apply([
    { type: "updateVisual", id: target, visual: { locked: false } },
  ]);
  expect(editor.getText(target)).toBe("While locked");
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...(editor.store.get(id)?.semantic as object),
        autoRefresh: false,
      },
    },
  ]);
  editor.setText(child.id, "Disabled");
  expect(editor.getText(target)).toBe("While locked");
});

test("automatic refresh propagates through nested component dependencies", () => {
  const { editor, child, id, target } = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...(editor.store.get(id)?.semantic as object),
        autoRefresh: true,
      },
    },
  ]);
  const wrapper = editor.buildElement("frame", {
    semantic: { name: "Wrapper", component: true, memberIds: [id] },
  });
  editor.apply([{ type: "createElement", element: wrapper }]);
  const outer = editor.createComponentInstance(wrapper.id, { x: 500, y: 500 });
  if (!outer) throw new Error("missing outer instance");
  const semantic = editor.store.get(outer)?.semantic as FrameSemantic;
  const outerText = semantic.instanceBindings?.find(
    (binding) => binding.source === target,
  )?.target;
  if (!outerText) throw new Error("missing nested text");
  editor.apply([
    {
      type: "updateSemantic",
      id: outer,
      semantic: { ...semantic, autoRefresh: true },
    },
  ]);
  editor.setText(child.id, "Nested update");
  expect(editor.getText(target)).toBe("Nested update");
  expect(editor.getText(outerText)).toBe("Nested update");
  editor.undo();
  expect(editor.getText(outerText)).toBe("Default");
});

test("automatic refresh reconciles source additions in the same undo step", () => {
  const { editor, source, id, target } = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...(editor.store.get(id)?.semantic as object),
        autoRefresh: true,
      },
    },
    { type: "updateVisual", id: target, visual: { x: 180 } },
  ]);
  const added = editor.buildElement("node.generic", {
    semantic: { label: "Icon" },
    visual: { x: 20, y: 20, width: 20, height: 20 },
  });
  editor.apply([
    { type: "createElement", element: added },
    {
      type: "updateSemantic",
      id: source.id,
      semantic: {
        ...(source.semantic as object),
        memberIds: [
          ...((source.semantic as FrameSemantic).memberIds ?? []),
          added.id,
        ],
      },
    },
  ]);
  const semantic = editor.store.get(id)?.semantic as FrameSemantic;
  const addedTarget = semantic.instanceBindings?.find(
    (binding) => binding.source === added.id,
  )?.target;
  if (!addedTarget) throw new Error("missing automatically added target");
  expect(semantic.memberIds).toEqual([target, addedTarget]);
  expect(editor.store.get(target)?.visual.x).toBe(180);
  expect(componentOverrides(editor, target).map((item) => item.field)).toEqual([
    "geometry.x",
  ]);

  editor.undo();
  expect(editor.store.has(added.id)).toBe(false);
  expect(editor.store.has(addedTarget ?? "")).toBe(false);
  expect((editor.store.get(id)?.semantic as FrameSemantic).memberIds).toEqual([
    target,
  ]);
  expect(editor.store.get(target)?.visual.x).toBe(180);
  editor.redo();
  expect(editor.store.has(addedTarget ?? "")).toBe(true);
});

test("automatic refresh follows reparenting and removal while retaining locals", () => {
  const { editor, source, child, id, target } = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...(editor.store.get(id)?.semantic as object),
        autoRefresh: true,
      },
    },
  ]);
  const local = editor.buildElement("text.note", {
    semantic: { text: "Local" },
    visual: { x: 170, y: 40, width: 40, height: 20 },
  });
  editor.apply([{ type: "createElement", element: local }]);
  editor.reparentElement(local.id, id);
  const inner = editor.buildElement("frame", {
    semantic: { name: "Inner", memberIds: [child.id] },
    visual: { x: 0, y: 0, width: 100, height: 60 },
  });
  editor.apply([
    { type: "createElement", element: inner },
    {
      type: "updateSemantic",
      id: source.id,
      semantic: { ...(source.semantic as object), memberIds: [inner.id] },
    },
  ]);
  const semantic = editor.store.get(id)?.semantic as FrameSemantic;
  const innerTarget = semantic.instanceBindings?.find(
    (binding) => binding.source === inner.id,
  )?.target;
  if (!innerTarget) throw new Error("missing automatically nested target");
  expect(
    (editor.store.get(innerTarget ?? "")?.semantic as FrameSemantic).memberIds,
  ).toEqual([target]);
  expect(semantic.memberIds).toEqual([innerTarget, local.id]);

  editor.deleteElements([inner.id]);
  expect(editor.store.has(innerTarget ?? "")).toBe(false);
  expect(editor.store.has(target)).toBe(false);
  expect(editor.store.has(local.id)).toBe(true);
  expect((editor.store.get(id)?.semantic as FrameSemantic).memberIds).toEqual([
    local.id,
  ]);
});

test("nested automatic structure refreshes dependency-first", () => {
  const { editor, source, id } = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...(editor.store.get(id)?.semantic as object),
        autoRefresh: true,
      },
    },
  ]);
  const wrapper = editor.buildElement("frame", {
    semantic: { name: "Wrapper", component: true, memberIds: [id] },
    visual: { x: 120, y: 0, width: 140, height: 80 },
  });
  editor.apply([{ type: "createElement", element: wrapper }]);
  const outer = editor.createComponentInstance(wrapper.id, { x: 500, y: 0 });
  if (!outer) throw new Error("missing outer component instance");
  editor.apply([
    {
      type: "updateSemantic",
      id: outer,
      semantic: {
        ...(editor.store.get(outer)?.semantic as object),
        autoRefresh: true,
      },
    },
  ]);

  const added = editor.buildElement("node.generic", {
    semantic: { label: "Nested addition" },
    visual: { x: 20, y: 35, width: 60, height: 20 },
  });
  editor.apply([
    { type: "createElement", element: added },
    {
      type: "updateSemantic",
      id: source.id,
      semantic: {
        ...(source.semantic as object),
        memberIds: [
          ...((source.semantic as FrameSemantic).memberIds ?? []),
          added.id,
        ],
      },
    },
  ]);
  const innerAdded = (
    editor.store.get(id)?.semantic as FrameSemantic
  ).instanceBindings?.find((binding) => binding.source === added.id)?.target;
  if (!innerAdded) throw new Error("missing inner propagated layer");
  const outerAdded = (
    editor.store.get(outer)?.semantic as FrameSemantic
  ).instanceBindings?.find((binding) => binding.source === innerAdded)?.target;
  if (!outerAdded) throw new Error("missing outer propagated layer");
  expect(editor.store.get(outerAdded)?.semantic).toEqual({
    label: "Nested addition",
  });
  editor.undo();
  expect(editor.store.has(innerAdded)).toBe(false);
  expect(editor.store.has(outerAdded)).toBe(false);
});

test("automatic structural refresh is a no-op for unrelated edits", () => {
  const { editor, id, target } = fixture();
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...(editor.store.get(id)?.semantic as object),
        autoRefresh: true,
      },
    },
  ]);
  const artboard = editor.buildElement("frame", {
    semantic: { name: "Screen", memberIds: [] },
    visual: { x: 120, y: 0, width: 300, height: 300 },
  });
  editor.apply([{ type: "createElement", element: artboard }]);
  expect(editor.reparentElement(id, artboard.id)).toBe(true);
  const unrelated = editor.buildElement("node.generic", {
    semantic: { label: "Elsewhere" },
    visual: { x: 500, y: 500, width: 100, height: 50 },
  });
  editor.apply([{ type: "createElement", element: unrelated }]);
  const before = editor.store.get(target);
  const result = editor.apply([
    {
      type: "updateSemantic",
      id: unrelated.id,
      semantic: { label: "Renamed elsewhere" },
    },
  ]);
  expect(result.redo).toHaveLength(1);
  expect(editor.store.get(target)).toEqual(before);
});

test("individual resets preserve unrelated overrides and inherited pending changes", () => {
  const { editor, child, id, target } = fixture();
  editor.setText(target, "Customized");
  editor.selection.set([target]);
  editor.setSelectionStyle({ color: "#ff0000" });
  editor.setText(child.id, "New source");
  editor.selection.set([child.id]);
  editor.setSelectionStyle({ fontSize: 28 });
  expect(componentOverrides(editor, target).map((item) => item.field)).toEqual([
    "text",
    "style.color",
  ]);
  const before = editor.getSnapshot();
  expect(editor.resetComponentOverride(id, target, "text")).toBe(true);
  expect(editor.getText(target)).toBe("New source");
  expect(componentOverrides(editor, target).map((item) => item.field)).toEqual([
    "style.color",
  ]);
  editor.refreshComponentInstance(id);
  expect(editor.store.get(target)?.visual.style?.fontSize).toBe(28);
  expect(editor.store.get(target)?.visual.style?.color).toBe("#ff0000");
  editor.undo();
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("reset can remove a custom style and tracks future source values", () => {
  const { editor, child, id, target } = fixture();
  editor.selection.set([target]);
  editor.setSelectionStyle({ opacity: 0.5 });
  expect(editor.resetComponentOverride(id, target, "style.opacity")).toBe(true);
  expect(editor.store.get(target)?.visual.style?.opacity).toBeUndefined();
  editor.selection.set([child.id]);
  editor.setSelectionStyle({ opacity: 0.8 });
  editor.refreshComponentInstance(id);
  expect(editor.store.get(target)?.visual.style?.opacity).toBe(0.8);
});

test("root text reset retains tracking and survives save/reopen", () => {
  const { editor, source, id } = fixture();
  editor.setText(id, "Checkout button");
  editor.setText(source.id, "Primary button");
  expect(editor.resetComponentOverride(id, id, "text")).toBe(true);
  expect(editor.getText(id)).toBe("Primary button");
  editor.loadDocument(parseDocument(serializeDocument(editor.getSnapshot())));
  expect(
    (editor.store.get(id)?.semantic as FrameSemantic).instanceBindings?.length,
  ).toBe(2);
  expect(componentOverrides(editor, id)).toEqual([]);
  editor.setText(source.id, "Action button");
  editor.refreshComponentInstance(id);
  expect(editor.getText(id)).toBe("Action button");
});

test("structure update reuses unkeyed source identities and adds new layers atomically", () => {
  const { editor, source, child, id, target } = fixture();
  editor.setText(target, "Custom label");
  const added = editor.buildElement("node.generic", {
    visual: { x: 15, y: 45, width: 40, height: 10 },
  });
  editor.apply([
    { type: "createElement", element: added },
    { type: "updateVisual", id: child.id, visual: { width: 95 } },
    {
      type: "updateSemantic",
      id: source.id,
      semantic: {
        ...(source.semantic as object),
        memberIds: [child.id, added.id],
      },
    },
  ]);
  const before = editor.getSnapshot();
  expect(editor.updateComponentStructure(id)).toBe(true);
  const semantic = editor.store.get(id)?.semantic as FrameSemantic;
  expect(semantic.memberIds?.length).toBe(2);
  expect(semantic.memberIds?.[0]).toBe(target);
  expect(editor.getText(target)).toBe("Custom label");
  expect(editor.store.get(target)?.visual.width).toBe(95);
  expect(
    semantic.instanceBindings?.some((binding) => binding.source === added.id),
  ).toBe(true);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("structure update preserves explicit geometry overrides", () => {
  const { editor, child, id, target } = fixture();
  editor.apply([
    { type: "updateVisual", id: target, visual: { x: 190, width: 140 } },
    { type: "updateVisual", id: child.id, visual: { x: 30, width: 100 } },
  ]);
  expect(editor.updateComponentStructure(id)).toBe(true);
  expect(editor.store.get(target)?.visual).toMatchObject({
    x: 190,
    width: 140,
  });
  expect(componentOverrides(editor, target).map((item) => item.field)).toEqual([
    "geometry.x",
    "geometry.width",
  ]);
  expect(editor.resetComponentOverride(id, target, "geometry.x")).toBe(true);
  expect(editor.store.get(target)?.visual.x).toBe(170);
});

test("structure update removes deleted source layers but keeps surviving external references", () => {
  const { editor, source, child, id, target } = fixture();
  const extra = editor.buildElement("node.generic");
  editor.apply([
    { type: "createElement", element: extra },
    {
      type: "updateSemantic",
      id: source.id,
      semantic: {
        ...(source.semantic as object),
        memberIds: [child.id, extra.id],
      },
    },
  ]);
  editor.updateComponentStructure(id);
  const extraTarget = (editor.store.get(id)?.semantic as FrameSemantic)
    .memberIds?.[1];
  const edge = editor.buildElement("edge.generic", {
    semantic: { from: target, to: id },
  });
  editor.apply([{ type: "createElement", element: edge }]);
  editor.deleteElements([extra.id]);
  expect(editor.updateComponentStructure(id)).toBe(true);
  expect(editor.store.has(extraTarget ?? "")).toBe(false);
  expect(editor.store.get(edge.id)?.semantic).toEqual(edge.semantic);
  expect(editor.store.has(target)).toBe(true);
});

test("structure updates preserve locally added layers and their content", () => {
  const { editor, id, source } = fixture();
  const local = editor.buildElement("text.note", {
    semantic: { text: "Instance-only note" },
    visual: { x: 160, y: 20, width: 70, height: 20 },
  });
  editor.apply([{ type: "createElement", element: local }]);
  editor.reparentElement(local.id, id);
  editor.setText(source.id, "Updated source");
  const before = editor.getSnapshot();
  expect(editor.updateComponentStructure(id)).toBe(true);
  expect(editor.store.get(local.id)?.semantic).toEqual(local.semantic);
  expect((editor.store.get(id)?.semantic as FrameSemantic).memberIds).toContain(
    local.id,
  );
  expect(editor.updateComponentStructure(id)).toBe(true);
  expect(
    (editor.store.get(id)?.semantic as FrameSemantic).memberIds?.filter(
      (member) => member === local.id,
    ),
  ).toHaveLength(1);
  editor.undo();
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("local descendants of a removed source frame are reattached to the instance root", () => {
  const { editor, source, child, id } = fixture();
  const inner = editor.buildElement("frame", {
    semantic: { name: "Inner", memberIds: [child.id] },
    visual: { x: 0, y: 0, width: 100, height: 50 },
  });
  editor.apply([
    { type: "createElement", element: inner },
    {
      type: "updateSemantic",
      id: source.id,
      semantic: { ...(source.semantic as object), memberIds: [inner.id] },
    },
  ]);
  editor.updateComponentStructure(id);
  const innerTarget = (editor.store.get(id)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!innerTarget) throw new Error("missing inner instance frame");
  const local = editor.buildElement("text.note", {
    semantic: { text: "Keep me" },
    visual: { x: 160, y: 5, width: 60, height: 15 },
  });
  editor.apply([{ type: "createElement", element: local }]);
  editor.reparentElement(local.id, innerTarget);
  editor.deleteElements([inner.id]);
  expect(editor.updateComponentStructure(id)).toBe(true);
  expect(editor.store.has(innerTarget)).toBe(false);
  expect(editor.store.has(local.id)).toBe(true);
  expect((editor.store.get(id)?.semantic as FrameSemantic).memberIds).toContain(
    local.id,
  );
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  editor.resetComponentInstance(id);
  expect(editor.store.has(local.id)).toBe(false);
});

test("locked override resets reject without mutation and detached layers expose none", () => {
  const { editor, id, target } = fixture();
  editor.setText(target, "Override");
  editor.apply([
    { type: "updateVisual", id: target, visual: { locked: true } },
  ]);
  expect(componentOverrides(editor, target)[0]?.locked).toBe(true);
  const before = editor.getSnapshot();
  expect(editor.resetComponentOverride(id, target, "text")).toBe(false);
  expect(editor.getSnapshot()).toEqual(before);
  editor.detachComponentInstance(id);
  expect(componentOverrides(editor, target)).toEqual([]);
});

test("refresh inherits source changes while preserving per-field overrides and IDs", () => {
  const { editor, child, id, target } = fixture();
  editor.setText(target, "Buy now");
  editor.selection.set([target]);
  editor.setSelectionStyle({ color: "#ff0000" });
  const before = editor.store.get(target)?.visual;
  editor.setText(child.id, "Updated default");
  editor.selection.set([child.id]);
  editor.setSelectionStyle({ color: "#0000ff", fontSize: 20, fill: null });
  expect(editor.refreshComponentInstance(id)).toBe(true);
  expect(editor.getText(target)).toBe("Buy now");
  expect(editor.store.get(target)?.visual.style).toEqual({
    color: "#ff0000",
    fontSize: 20,
  });
  expect(editor.store.get(target)?.visual.x).toBe(before?.x);
  const updated = editor.getSnapshot();
  expect(parseDocument(serializeDocument(updated))).toEqual(updated);
  editor.undo();
  expect(editor.store.get(target)?.visual).toEqual(before);
  editor.redo();
  expect(editor.getSnapshot()).toEqual(updated);
  const revision = editor.revision;
  expect(editor.refreshComponentInstance(id)).toBe(true);
  expect(editor.revision).toBe(revision);
});

test("component geometry refreshes relatively while root placement stays local", () => {
  const { editor, source, child, id, target } = fixture();
  const instanceX = editor.store.get(id)?.visual.x;
  expect(instanceX).toBe(140);
  expect(componentOverrides(editor, target)).toEqual([]);

  editor.apply([
    {
      type: "updateVisual",
      id: source.id,
      visual: { x: 50, width: 120 },
    },
    {
      type: "updateVisual",
      id: child.id,
      visual: { x: 70, y: 20, height: 40, rotation: 5 },
    },
  ]);
  expect(editor.refreshComponentInstance(id)).toBe(true);
  expect(editor.store.get(id)?.visual).toMatchObject({ x: 140, width: 120 });
  expect(editor.store.get(target)?.visual).toMatchObject({
    x: 160,
    y: 20,
    height: 40,
    rotation: 5,
  });
  expect(componentOverrides(editor, target)).toEqual([]);
});

test("geometry overrides reset individually and survive JSONL undo and locks", () => {
  const { editor, child, id, target } = fixture();
  editor.apply([
    {
      type: "updateVisual",
      id: target,
      visual: { x: 175, width: 120, rotation: 15 },
    },
    {
      type: "updateVisual",
      id: child.id,
      visual: { x: 20, width: 90, rotation: 5 },
    },
  ]);
  expect(componentOverrides(editor, target).map((item) => item.field)).toEqual([
    "geometry.x",
    "geometry.width",
    "geometry.rotation",
  ]);

  expect(editor.resetComponentOverride(id, target, "geometry.x")).toBe(true);
  expect(editor.store.get(target)?.visual).toMatchObject({
    x: 160,
    width: 120,
    rotation: 15,
  });
  expect(componentOverrides(editor, target).map((item) => item.field)).toEqual([
    "geometry.width",
    "geometry.rotation",
  ]);
  expect(editor.resetComponentOverride(id, target, "geometry.width")).toBe(
    true,
  );
  expect(editor.store.get(target)?.visual.width).toBe(90);
  const reset = editor.getSnapshot();
  expect(parseDocument(serializeDocument(reset))).toEqual(reset);
  editor.undo();
  expect(editor.store.get(target)?.visual.width).toBe(120);
  editor.redo();
  expect(editor.getSnapshot()).toEqual(reset);

  editor.apply([
    { type: "updateVisual", id: target, visual: { locked: true } },
  ]);
  const before = editor.getSnapshot();
  expect(editor.resetComponentOverride(id, target, "geometry.rotation")).toBe(
    false,
  );
  expect(editor.getSnapshot()).toEqual(before);
});

test("component geometry refresh and reset include size limits and aspect ratio", () => {
  const { editor, child, id, target } = fixture();
  editor.apply([
    {
      type: "updateVisual",
      id: child.id,
      visual: {
        minWidth: 72,
        maxWidth: 180,
        minHeight: 32,
        aspectRatio: 2,
      },
    },
  ]);
  expect(editor.refreshComponentInstance(id)).toBe(true);
  expect(editor.store.get(target)?.visual).toMatchObject({
    minWidth: 72,
    maxWidth: 180,
    minHeight: 32,
    aspectRatio: 2,
  });

  editor.apply([
    {
      type: "updateVisual",
      id: target,
      visual: { maxWidth: 220, aspectRatio: 3 },
    },
    {
      type: "updateVisual",
      id: child.id,
      visual: { maxWidth: 200, aspectRatio: 2.5 },
    },
  ]);
  expect(
    componentOverrides(editor, target).map((item) => item.field),
  ).toContain("geometry.maxWidth");
  expect(editor.resetComponentOverride(id, target, "geometry.maxWidth")).toBe(
    true,
  );
  expect(editor.store.get(target)?.visual.maxWidth).toBe(200);
  expect(
    componentOverrides(editor, target).map((item) => item.field),
  ).toContain("geometry.aspectRatio");
  expect(
    editor.resetComponentOverride(id, target, "geometry.aspectRatio"),
  ).toBe(true);
  expect(editor.store.get(target)?.visual.aspectRatio).toBe(2.5);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
});

test("instance root movement is not a geometry override", () => {
  const { editor, id } = fixture();
  editor.moveElements([{ id, x: 400, y: 300 }]);
  expect(componentOverrides(editor, id)).toEqual([]);
  expect(editor.refreshComponentInstance(id)).toBe(true);
  expect(editor.store.get(id)?.visual).toMatchObject({ x: 400, y: 300 });
});

test("unchanged text follows repeated source refreshes after reopening", () => {
  const { editor, child, id, target } = fixture();
  editor.setText(child.id, "First");
  editor.refreshComponentInstance(id);
  expect(editor.getText(target)).toBe("First");
  editor.loadDocument(parseDocument(serializeDocument(editor.getSnapshot())));
  editor.setText(child.id, "Second");
  editor.refreshComponentInstance(id);
  expect(editor.getText(target)).toBe("Second");
});

test("deleted binding endpoints detach without breaking surviving instance content", () => {
  const { editor, child, id, target } = fixture();
  editor.deleteElements([child.id]);
  const binding = (
    editor.store.get(id)?.semantic as FrameSemantic
  ).instanceBindings?.find((item) => item.target === target);
  expect(binding?.source).toBeUndefined();
  expect(editor.refreshComponentInstance(id)).toBe(true);
  expect(editor.getText(target)).toBe("Default");
  expect(() => serializeDocument(editor.getSnapshot())).not.toThrow();
});

test("copying definitions and instances remaps tracking endpoints", () => {
  const { editor, source, id } = fixture();
  editor.selection.set([source.id, id]);
  editor.copySelection();
  editor.paste();
  const instances = editor
    .getSnapshot()
    .elements.filter(
      (item) =>
        item.type === "frame" && (item.semantic as FrameSemantic).instanceOf,
    );
  const copied = instances.find((item) => item.id !== id);
  if (!copied) throw new Error("missing copied instance");
  const semantic = copied.semantic as FrameSemantic;
  expect(semantic.instanceOf).not.toBe(source.id);
  expect(
    semantic.instanceBindings?.some(
      (binding) =>
        binding.target === copied.id && binding.source === semantic.instanceOf,
    ),
  ).toBe(true);
  expect(editor.refreshComponentInstance(copied.id)).toBe(true);
});

test("locked descendants and malformed tracking reject refresh atomically", () => {
  const { editor, child, id, target } = fixture();
  editor.setText(child.id, "New");
  editor.apply([
    { type: "updateVisual", id: target, visual: { locked: true } },
  ]);
  const before = editor.getSnapshot();
  expect(editor.refreshComponentInstance(id)).toBe(false);
  expect(editor.getSnapshot()).toEqual(before);
  editor.undo();
  const semantic = editor.store.get(id)?.semantic as FrameSemantic;
  editor.apply([
    {
      type: "updateSemantic",
      id,
      semantic: {
        ...semantic,
        instanceBindings: semantic.instanceBindings?.map((binding) => ({
          ...binding,
          baseline: "invalid JSON",
        })),
      },
    },
  ]);
  expect(editor.refreshComponentInstance(id)).toBe(false);
  expect(editor.getText(target)).toBe("Default");
});
