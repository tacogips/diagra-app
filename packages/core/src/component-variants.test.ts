import { expect, test } from "bun:test";
import { assertValidDocument, type FrameSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import {
  addComponentVariantProperty,
  componentVariantAxes,
  componentVariants,
  removeComponentVariantProperty,
  switchComponentVariantProperty,
  updateComponentVariantProperty,
} from "./component-variants.ts";
import { makeEditor } from "./test-helpers.ts";

function fixture() {
  const editor = makeEditor();
  const normal = editor.buildElement("frame", {
    semantic: {
      name: "Button",
      component: true,
      variantSet: "Button",
      variantName: "Default",
      memberIds: [],
    },
    visual: { x: 0, y: 0, width: 100, height: 40 },
  });
  editor.apply([{ type: "createElement", element: normal }]);
  editor.createPage({ name: "States" });
  const child = editor.buildElement("text.note", {
    semantic: { text: "Unavailable" },
    visual: { x: 10, y: 10, width: 80, height: 20 },
  });
  const disabled = editor.buildElement("frame", {
    semantic: {
      name: "Button disabled",
      component: true,
      variantSet: "Button",
      variantName: "Disabled",
      memberIds: [child.id],
    },
    visual: { x: 0, y: 0, width: 120, height: 40 },
  });
  editor.apply([
    { type: "createElement", element: disabled },
    { type: "createElement", element: child },
  ]);
  const id = editor.createComponentInstance(normal.id, { x: 400, y: 300 });
  if (!id) throw new Error("missing instance");
  return { editor, normal, disabled, id };
}

test("keyed variants preserve child IDs and overrides while adopting new geometry", () => {
  const { editor, normal, disabled, id } = fixture();
  const normalChild = editor.buildElement("text.note", {
    page: normal.page,
    semantic: { text: "Default label" },
    visual: {
      x: 10,
      y: 10,
      width: 80,
      height: 20,
      componentKey: "label",
      style: { fontSize: 14, color: "#000000" },
    },
  });
  editor.apply([
    { type: "createElement", element: normalChild },
    {
      type: "updateSemantic",
      id: normal.id,
      semantic: { ...(normal.semantic as object), memberIds: [normalChild.id] },
    },
  ]);
  const alternateChild = (disabled.semantic as FrameSemantic).memberIds?.[0];
  if (!alternateChild) throw new Error("missing alternate label");
  editor.apply([
    {
      type: "updateVisual",
      id: alternateChild,
      visual: {
        componentKey: "label",
        width: 95,
        style: { fontSize: 18, color: "#888888" },
      },
    },
  ]);
  editor.resetComponentInstance(id);
  const target = (editor.store.get(id)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!target) throw new Error("missing target");
  editor.setText(target, "My label");
  editor.selection.set([target]);
  editor.setSelectionStyle({ color: "#ff0000" });
  const before = editor.getSnapshot();
  expect(editor.switchComponentVariant(id, disabled.id)).toBe(true);
  expect((editor.store.get(id)?.semantic as FrameSemantic).memberIds).toEqual([
    target,
  ]);
  expect(editor.getText(target)).toBe("My label");
  expect(editor.store.get(target)?.visual.width).toBe(95);
  expect(editor.store.get(target)?.visual.style).toEqual({
    fontSize: 18,
    color: "#ff0000",
  });
  const saved = parseDocument(serializeDocument(editor.getSnapshot()));
  expect(saved).toEqual(editor.getSnapshot());
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  editor.redo();
  expect(editor.switchComponentVariant(id, normal.id)).toBe(true);
  expect(editor.getText(target)).toBe("My label");
  expect(editor.store.get(target)?.visual.style?.fontSize).toBe(14);
});

test("ambiguous destination keys reject without changing instance content", () => {
  const { editor, disabled, id } = fixture();
  const first = (disabled.semantic as FrameSemantic).memberIds?.[0];
  if (!first) throw new Error("missing child");
  const extra = editor.buildElement("text.note", {
    visual: { componentKey: "label" },
  });
  editor.apply([
    { type: "createElement", element: extra },
    { type: "updateVisual", id: first, visual: { componentKey: "label" } },
    {
      type: "updateSemantic",
      id: disabled.id,
      semantic: {
        ...(disabled.semantic as object),
        memberIds: [first, extra.id],
      },
    },
  ]);
  const before = editor.getSnapshot();
  expect(editor.switchComponentVariant(id, disabled.id)).toBe(false);
  expect(editor.getSnapshot()).toEqual(before);
});

test("named variants resolve across pages and persist through JSONL", () => {
  const { editor, normal } = fixture();
  expect(
    componentVariants(editor, normal.id).map((item) => item.label),
  ).toEqual(["Default", "Disabled"]);
  const saved = editor.getSnapshot();
  expect(parseDocument(serializeDocument(saved))).toEqual(saved);
  expect(() =>
    assertValidDocument({
      ...saved,
      elements: [
        {
          ...normal,
          semantic: { ...(normal.semantic as object), variantName: 123 },
        },
      ],
    }),
  ).toThrow();
});

test("variant switch preserves root position and rebuilds tracking in one undo step", () => {
  const { editor, disabled, id } = fixture();
  const before = editor.getSnapshot();
  expect(editor.switchComponentVariant(id, disabled.id)).toBe(true);
  const instance = editor.store.get(id);
  expect(instance?.visual.x).toBe(400);
  expect(instance?.visual.y).toBe(300);
  expect(instance?.visual.width).toBe(120);
  const semantic = instance?.semantic as FrameSemantic;
  expect(semantic.instanceOf).toBe(disabled.id);
  expect(semantic.instanceBindings?.length).toBe(2);
  expect(editor.getText(semantic.memberIds?.[0] ?? "")).toBe("Unavailable");
  const after = editor.getSnapshot();
  editor.undo();
  expect(editor.getSnapshot()).toEqual(before);
  editor.redo();
  expect(editor.getSnapshot()).toEqual(after);
  expect(editor.refreshComponentInstance(id)).toBe(true);
});

test("unrelated components and locked instances reject variant switches", () => {
  const { editor, disabled, id } = fixture();
  const other = editor.buildElement("frame", {
    semantic: {
      name: "Other",
      component: true,
      variantSet: "Other",
      memberIds: [],
    },
  });
  editor.apply([{ type: "createElement", element: other }]);
  expect(editor.switchComponentVariant(id, other.id)).toBe(false);
  editor.apply([{ type: "updateVisual", id, visual: { locked: true } }]);
  const before = editor.getSnapshot();
  expect(editor.switchComponentVariant(id, disabled.id)).toBe(false);
  expect(editor.getSnapshot()).toEqual(before);
});

test("variant properties are validated, persisted and edited with exact undo", () => {
  const { editor, normal } = fixture();
  expect(
    addComponentVariantProperty(
      editor,
      normal.id,
      " State ",
      " Default ",
      "state-property",
    ),
  ).toBe(true);
  expect(
    addComponentVariantProperty(
      editor,
      normal.id,
      "state",
      "Hover",
      "duplicate-name",
    ),
  ).toBe(false);
  expect(
    updateComponentVariantProperty(
      editor,
      normal.id,
      "state-property",
      "Interaction",
      "Rest",
    ),
  ).toBe(true);
  expect(
    (editor.store.get(normal.id)?.semantic as FrameSemantic).variantProperties,
  ).toEqual([{ id: "state-property", name: "Interaction", value: "Rest" }]);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  editor.undo();
  expect(
    (editor.store.get(normal.id)?.semantic as FrameSemantic)
      .variantProperties?.[0],
  ).toMatchObject({ name: "State", value: "Default" });
  expect(
    removeComponentVariantProperty(editor, normal.id, "state-property"),
  ).toBe(true);
  expect(
    (editor.store.get(normal.id)?.semantic as FrameSemantic).variantProperties,
  ).toBeUndefined();
  editor.undo();
  editor.apply([
    { type: "updateVisual", id: normal.id, visual: { locked: true } },
  ]);
  expect(
    updateComponentVariantProperty(
      editor,
      normal.id,
      "state-property",
      "State",
      "Hover",
    ),
  ).toBe(false);
});

function matrixFixture() {
  const editor = makeEditor();
  const definitions = [
    ["default-small", "Default", "Small"],
    ["hover-small", "Hover", "Small"],
    ["default-large", "Default", "Large"],
    ["hover-large", "Hover", "Large"],
  ].map(([id, state, size]) =>
    editor.buildElement("frame", {
      id,
      semantic: {
        name: `Button ${state} ${size}`,
        component: true,
        variantSet: "Button matrix",
        memberIds: [],
        variantProperties: [
          { id: `${id}-state`, name: "State", value: state },
          { id: `${id}-size`, name: "Size", value: size },
        ],
      },
      visual: { x: 0, y: 0, width: size === "Large" ? 160 : 100, height: 40 },
    }),
  );
  editor.apply(
    definitions.map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const instance = editor.createComponentInstance("default-small");
  if (!instance) throw new Error("missing matrix instance");
  return { editor, definitions, instance };
}

test("instances switch one variant axis while retaining the other axes", () => {
  const { editor, instance } = matrixFixture();
  expect(componentVariantAxes(editor, "default-small")).toEqual([
    { name: "State", value: "Default", values: ["Default", "Hover"] },
    { name: "Size", value: "Small", values: ["Large", "Small"] },
  ]);
  expect(
    switchComponentVariantProperty(editor, instance, "State", "Hover"),
  ).toBe(true);
  expect(
    (editor.store.get(instance)?.semantic as FrameSemantic).instanceOf,
  ).toBe("hover-small");
  expect(
    switchComponentVariantProperty(editor, instance, "Size", "Large"),
  ).toBe(true);
  expect(
    (editor.store.get(instance)?.semantic as FrameSemantic).instanceOf,
  ).toBe("hover-large");
  expect(editor.store.get(instance)?.visual.width).toBe(160);
  editor.undo();
  expect(
    (editor.store.get(instance)?.semantic as FrameSemantic).instanceOf,
  ).toBe("hover-small");
});

test("ambiguous property combinations reject atomically", () => {
  const { editor, definitions, instance } = matrixFixture();
  const duplicate = editor.buildElement("frame", {
    semantic: {
      ...(definitions[1]?.semantic as FrameSemantic),
      name: "Duplicate hover small",
      memberIds: [],
    },
  });
  editor.apply([{ type: "createElement", element: duplicate }]);
  const before = editor.getSnapshot();
  expect(
    switchComponentVariantProperty(editor, instance, "State", "Hover"),
  ).toBe(false);
  expect(editor.getSnapshot()).toEqual(before);
});
