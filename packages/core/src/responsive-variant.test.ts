import { expect, test } from "bun:test";
import type { FrameSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { createColorToken } from "./color-tokens.ts";
import { makeEditor } from "./test-helpers.ts";
import { insertUiBlock } from "./ui-blocks.ts";
import { copyElements } from "./clipboard.ts";
import { rotatedBox } from "./geometry.ts";

test("responsive screens avoid existing same-page frames and retain placement through undo", () => {
  const editor = makeEditor();
  const web = editor.createElement("frame", {
    semantic: { name: "Web", memberIds: [] },
    visual: { x: 0, y: 0, width: 1440, height: 900 },
  });
  const blocker = editor.createElement("frame", {
    semantic: { name: "Reserved", memberIds: [] },
    visual: {
      x: 1700,
      y: 0,
      width: 200,
      height: 100,
      hidden: true,
      locked: true,
    },
  });
  editor.createElement("frame", {
    semantic: { name: "Other row", memberIds: [] },
    visual: { x: 3000, y: 2000, width: 300, height: 300 },
  });
  const otherPage = editor.createPage({ name: "Other page" });
  editor.createElement("frame", {
    semantic: { name: "Unrelated", memberIds: [] },
    visual: { x: 1900, y: 0, width: 2000, height: 2000 },
  });
  editor.setCurrentPage(editor.store.get(web)?.page ?? otherPage);
  const iphone = editor.createResponsiveVariant(web, "iphone");
  const android = editor.createResponsiveVariant(web, "android");
  if (!iphone || !android) throw new Error("missing variants");
  expect(editor.getBounds(iphone)?.x).toBe(1980);
  expect(editor.getBounds(android)?.x).toBe(2450);
  expect(editor.getBounds(blocker)?.x).toBe(1700);
  const saved = serializeDocument(editor.getSnapshot());
  editor.undo();
  expect(editor.store.get(android)).toBeUndefined();
  editor.redo();
  expect(serializeDocument(editor.getSnapshot())).toBe(saved);
});

test("responsive placement leaves a gap between rotated frame envelopes", () => {
  const editor = makeEditor();
  const source = editor.createElement("frame", {
    semantic: { name: "Rotated", memberIds: [] },
    visual: { x: 0, y: 0, width: 500, height: 500, rotation: 45 },
  });
  const first = editor.createResponsiveVariant(source, "iphone");
  const second = editor.createResponsiveVariant(source, "android");
  if (!first || !second) throw new Error("missing rotated variants");
  const envelopes = [source, first, second].map((id) => {
    const box = editor.getBounds(id);
    if (!box) throw new Error("missing bounds");
    return rotatedBox(box, editor.store.get(id)?.visual.rotation ?? 0);
  });
  expect(
    (envelopes[1]?.x ?? 0) -
      ((envelopes[0]?.x ?? 0) + (envelopes[0]?.width ?? 0)),
  ).toBeCloseTo(80);
  expect(
    (envelopes[2]?.x ?? 0) -
      ((envelopes[1]?.x ?? 0) + (envelopes[1]?.width ?? 0)),
  ).toBeCloseTo(80);
});

test("responsive copies retain nested component sources and remap their tracking targets", () => {
  const editor = makeEditor();
  const source = insertUiBlock(editor, "button", { x: 1700, y: 0 });
  const label = (editor.store.get(source)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!label) throw new Error("missing source label");
  const web = editor.createElement("frame", {
    semantic: { name: "Web", memberIds: [] },
    visual: { x: 0, y: 0, width: 1440, height: 900 },
  });
  const instance = editor.createComponentInstance(source, { x: 20, y: 150 });
  if (!instance) throw new Error("missing instance");
  editor.apply([
    {
      type: "updateSemantic",
      id: instance,
      semantic: {
        ...(editor.store.get(instance)?.semantic as FrameSemantic),
        autoRefresh: true,
      },
    },
  ]);
  expect(editor.reparentElement(instance, web)).toBe(true);
  const mobile = editor.createResponsiveVariant(web, "iphone");
  if (!mobile) throw new Error("missing mobile");
  const nested = (editor.store.get(mobile)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!nested) throw new Error("missing nested instance");
  const semantic = editor.store.get(nested)?.semantic as FrameSemantic;
  const target = semantic.memberIds?.[0];
  if (!target) throw new Error("missing target label");
  expect(semantic.instanceOf).toBe(source);
  expect(semantic.autoRefresh).toBe(true);
  expect(
    semantic.instanceBindings?.map(({ source, target }) => ({
      source,
      target,
    })),
  ).toEqual([
    { source, target: nested },
    { source: label, target },
  ]);
  editor.undo();
  expect(editor.store.get(mobile)).toBeUndefined();
  editor.redo();
  expect((editor.store.get(nested)?.semantic as FrameSemantic).instanceOf).toBe(
    source,
  );
  expect(editor.setText(label, "Source update")).toBe(true);
  expect(editor.getText(target)).toBe("Source update");
  editor.undo();
  expect(editor.getText(target)).toBe("Continue");
  editor.redo();
  expect(editor.getText(target)).toBe("Source update");
  editor.setText(target, "Local override");
  editor.setText(label, "Another source update");
  expect(editor.getText(target)).toBe("Local override");
  const saved = serializeDocument(editor.getSnapshot());
  expect(serializeDocument(parseDocument(saved))).toBe(saved);
  // Portable clipboard behavior must still detach references left behind.
  const portable = copyElements(editor.store, [nested, target]);
  expect(
    (
      portable.elements.find((element) => element.id === nested)
        ?.semantic as FrameSemantic
    ).instanceOf,
  ).toBeUndefined();
});

test("responsive variants clone, reflow, preserve tokens and undo atomically", () => {
  const editor = makeEditor();
  const token = createColorToken(editor, "Action", "#2563eb");
  if (!token) throw new Error("expected token");
  const button = editor.buildElement("shape.geo", {
    id: "desktop-button",
    semantic: { geo: "rect", label: "Continue" },
    visual: {
      x: 120,
      y: 230,
      width: 1400,
      height: 48,
      horizontalConstraint: "stretch",
      verticalConstraint: "start",
      style: { fill: "#2563eb" },
      colorTokens: { fill: token },
    },
  });
  const desktop = editor.buildElement("frame", {
    id: "checkout-desktop",
    semantic: {
      name: "Checkout",
      platform: "web",
      memberIds: [button.id],
    },
    visual: { x: 100, y: 200, width: 1440, height: 900 },
  });
  editor.apply(
    [desktop, button].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );

  const mobileId = editor.createResponsiveVariant(desktop.id, "iphone");
  if (!mobileId) throw new Error("expected responsive variant");
  const mobile = editor.store.get(mobileId);
  expect(mobile?.visual).toMatchObject({
    x: 1620,
    y: 200,
    width: 390,
    height: 844,
  });
  expect(mobile?.semantic).toMatchObject({
    name: "Checkout — iPhone",
    platform: "ios",
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  });
  const memberId = (mobile?.semantic as FrameSemantic).memberIds?.[0];
  expect(memberId).not.toBe(button.id);
  expect(editor.store.get(memberId ?? "")?.visual).toMatchObject({
    x: 1640,
    y: 230,
    width: 350,
    height: 48,
    colorTokens: { fill: token },
  });
  expect([...editor.selection.ids()]).toEqual([mobileId]);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );

  editor.undo();
  expect(editor.store.get(mobileId)).toBeUndefined();
  expect(editor.store.get(memberId ?? "")).toBeUndefined();
  expect(editor.store.get(desktop.id)).toBeDefined();
  expect(editor.store.get(button.id)).toBeDefined();
  expect(editor.store.get(token)).toBeDefined();

  editor.redo();
  expect(editor.store.get(mobileId)).toBeDefined();
  expect(editor.store.get(memberId ?? "")).toBeDefined();
});

test("responsive variants reject missing and non-artboard roots", () => {
  const editor = makeEditor();
  const shape = editor.createElement("shape.geo");
  const locked = editor.createElement("frame", {
    visual: { locked: true },
  });
  const component = editor.createElement("frame", {
    semantic: { name: "Component", component: true },
  });
  expect(editor.createResponsiveVariant("missing", "web")).toBeNull();
  expect(editor.createResponsiveVariant(shape, "android")).toBeNull();
  expect(editor.createResponsiveVariant(locked, "iphone")).toBeNull();
  expect(editor.createResponsiveVariant(component, "iphone")).toBeNull();
});

test("responsive refresh inherits source content while preserving geometry and overrides", () => {
  const editor = makeEditor();
  const label = editor.buildElement("text.note", {
    semantic: { text: "Checkout" },
    visual: {
      x: 24,
      y: 80,
      width: 1392,
      height: 40,
      horizontalConstraint: "stretch",
      style: { color: "#111827", fontSize: 24 },
    },
  });
  const desktop = editor.buildElement("frame", {
    semantic: { name: "Flow", memberIds: [label.id] },
    visual: { x: 0, y: 0, width: 1440, height: 900 },
  });
  editor.apply(
    [desktop, label].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const mobileId = editor.createResponsiveVariant(desktop.id, "iphone");
  if (!mobileId) throw new Error("expected responsive variant");
  const mobileSemantic = editor.store.get(mobileId)?.semantic as FrameSemantic;
  const mobileLabelId = mobileSemantic.memberIds?.[0];
  if (!mobileLabelId) throw new Error("expected cloned label");
  expect(mobileSemantic.responsiveSource).toBe(desktop.id);
  expect(mobileSemantic.instanceBindings).toHaveLength(2);

  editor.apply([
    {
      type: "updateSemantic",
      id: label.id,
      semantic: { text: "Review order" },
    },
    {
      type: "updateVisual",
      id: label.id,
      visual: { style: { color: "#7c3aed", fontSize: 28 } },
    },
  ]);
  expect(editor.refreshResponsiveVariant(mobileId)).toBe(true);
  expect(editor.getText(mobileLabelId)).toBe("Review order");
  expect(editor.store.get(mobileLabelId)?.visual).toMatchObject({
    x: 24 + 1520,
    width: 342,
    style: { color: "#7c3aed", fontSize: 28 },
  });

  editor.apply([
    {
      type: "updateSemantic",
      id: mobileLabelId,
      semantic: { text: "Mobile checkout" },
    },
    {
      type: "updateSemantic",
      id: label.id,
      semantic: { text: "Submit order" },
    },
  ]);
  expect(editor.refreshResponsiveVariant(mobileId)).toBe(true);
  expect(editor.getText(mobileLabelId)).toBe("Mobile checkout");
  expect(editor.store.get(mobileLabelId)?.visual.width).toBe(342);

  expect(editor.resetComponentOverride(mobileId, mobileLabelId, "text")).toBe(
    true,
  );
  expect(editor.getText(mobileLabelId)).toBe("Submit order");
  editor.setText(label.id, "Place order");
  expect(editor.refreshResponsiveVariant(mobileId)).toBe(true);
  expect(editor.getText(mobileLabelId)).toBe("Place order");
  expect(editor.store.get(mobileLabelId)?.visual.width).toBe(342);

  expect(editor.detachResponsiveVariant(mobileId)).toBe(true);
  expect(
    (editor.store.get(mobileId)?.semantic as FrameSemantic).responsiveSource,
  ).toBeUndefined();
  expect(editor.refreshResponsiveVariant(mobileId)).toBe(false);
});

test("deleting a responsive source detaches the surviving viewport", () => {
  const editor = makeEditor();
  const child = editor.buildElement("text.note", {
    semantic: { text: "Source" },
    visual: { x: 20, y: 20, width: 200, height: 40 },
  });
  const source = editor.buildElement("frame", {
    semantic: { name: "Source", memberIds: [child.id] },
    visual: { x: 0, y: 0, width: 1440, height: 900 },
  });
  editor.apply(
    [source, child].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const variant = editor.createResponsiveVariant(source.id, "android");
  if (!variant) throw new Error("expected responsive variant");
  const variantMember = (editor.store.get(variant)?.semantic as FrameSemantic)
    .memberIds?.[0];

  editor.selection.set([source.id]);
  editor.deleteSelection();
  expect(editor.store.get(source.id)).toBeUndefined();
  expect(editor.store.get(child.id)).toBeUndefined();
  expect(editor.store.get(variant)).toBeDefined();
  expect(editor.store.get(variantMember ?? "")).toBeDefined();
  expect(
    (editor.store.get(variant)?.semantic as FrameSemantic).responsiveSource,
  ).toBeUndefined();
  expect(editor.refreshResponsiveVariant(variant)).toBe(false);
});

test("responsive structure updates preserve breakpoint geometry and local layers", () => {
  const editor = makeEditor();
  const title = editor.buildElement("text.note", {
    semantic: { text: "Checkout" },
    visual: {
      x: 20,
      y: 40,
      width: 1400,
      height: 40,
      horizontalConstraint: "stretch",
      style: { color: "#111827", fontSize: 24 },
    },
  });
  const obsolete = editor.buildElement("shape.geo", {
    semantic: { geo: "rect", label: "Old banner" },
    visual: { x: 20, y: 100, width: 1400, height: 40 },
  });
  const source = editor.buildElement("frame", {
    semantic: {
      name: "Checkout",
      memberIds: [title.id, obsolete.id],
    },
    visual: { x: 0, y: 0, width: 1440, height: 900 },
  });
  editor.apply(
    [source, title, obsolete].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const mobileId = editor.createResponsiveVariant(source.id, "iphone");
  if (!mobileId) throw new Error("expected responsive variant");
  const initial = editor.store.get(mobileId)?.semantic as FrameSemantic;
  const mobileTitle = initial.memberIds?.[0];
  const mobileObsolete = initial.memberIds?.[1];
  if (!mobileTitle || !mobileObsolete) throw new Error("missing mobile layers");

  editor.setText(mobileTitle, "Mobile checkout");
  editor.apply([
    {
      type: "updateVisual",
      id: mobileTitle,
      visual: { x: 1552, width: 326 },
    },
  ]);
  const local = editor.buildElement("text.note", {
    semantic: { text: "Mobile-only legal copy" },
    visual: { x: 1540, y: 760, width: 350, height: 40 },
  });
  editor.apply([{ type: "createElement", element: local }]);
  expect(editor.reparentElement(local.id, mobileId)).toBe(true);

  const action = editor.buildElement("shape.geo", {
    semantic: { geo: "rect", label: "Continue" },
    visual: {
      x: 20,
      y: 160,
      width: 1400,
      height: 48,
      horizontalConstraint: "stretch",
      style: { fill: "#2563eb" },
    },
  });
  editor.apply([
    { type: "createElement", element: action },
    {
      type: "updateSemantic",
      id: source.id,
      semantic: {
        ...(source.semantic as object),
        memberIds: [title.id, action.id],
      },
    },
    {
      type: "updateVisual",
      id: title.id,
      visual: { style: { color: "#7c3aed", fontSize: 28 } },
    },
  ]);
  const before = editor.getSnapshot();

  expect(editor.updateResponsiveStructure(mobileId)).toBe(true);
  const updated = editor.store.get(mobileId)?.semantic as FrameSemantic;
  expect(updated.memberIds).toContain(mobileTitle);
  expect(updated.memberIds).toContain(local.id);
  expect(editor.store.has(mobileObsolete)).toBe(false);
  expect(editor.getText(mobileTitle)).toBe("Mobile checkout");
  expect(editor.store.get(mobileTitle)?.visual).toMatchObject({
    x: 1552,
    width: 326,
    style: { color: "#7c3aed", fontSize: 28 },
  });
  expect(editor.store.get(mobileId)?.visual).toMatchObject({
    x: 1520,
    width: 390,
    height: 844,
  });
  const actionBinding = updated.instanceBindings?.find(
    (binding) => binding.source === action.id,
  );
  if (!actionBinding?.target) throw new Error("missing responsive action");
  expect(editor.store.get(actionBinding.target)?.visual).toMatchObject({
    x: 1540,
    width: 350,
    height: 48,
  });
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );

  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
});

test("responsive structure additions join the target auto layout", () => {
  const editor = makeEditor();
  const first = editor.buildElement("shape.geo", {
    semantic: { geo: "rect", label: "First" },
    visual: { x: 20, y: 20, width: 100, height: 40 },
  });
  const source = editor.buildElement("frame", {
    semantic: {
      name: "Toolbar",
      memberIds: [first.id],
      layout: {
        direction: "horizontal",
        gap: 10,
        padding: 20,
        sizing: "fixed",
        align: "start",
      },
    },
    visual: { x: 0, y: 0, width: 1440, height: 100 },
  });
  editor.apply(
    [source, first].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const mobile = editor.createResponsiveVariant(source.id, "android");
  if (!mobile) throw new Error("expected responsive variant");
  const second = editor.buildElement("shape.geo", {
    semantic: { geo: "rect", label: "Second" },
    visual: { x: 130, y: 20, width: 80, height: 40 },
  });
  editor.apply([
    { type: "createElement", element: second },
    {
      type: "updateSemantic",
      id: source.id,
      semantic: {
        ...(source.semantic as object),
        memberIds: [first.id, second.id],
      },
    },
  ]);

  expect(editor.updateResponsiveStructure(mobile)).toBe(true);
  const semantic = editor.store.get(mobile)?.semantic as FrameSemantic;
  const target = semantic.instanceBindings?.find(
    (binding) => binding.source === second.id,
  )?.target;
  if (!target) throw new Error("missing auto-layout target");
  expect(editor.store.get(target)?.visual).toMatchObject({
    x: 1650,
    y: 20,
    width: 80,
    height: 40,
  });
  expect(semantic.memberIds).toContain(target);
});
