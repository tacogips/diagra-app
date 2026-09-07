import { expect, test } from "bun:test";
import { inspectDesign } from "./handoff.ts";
import { makeEditor } from "./test-helpers.ts";

test("fractional fill factors export proportional CSS that consumes all free space", () => {
  const editor = makeEditor();
  const a = editor.buildElement("shape.geo", { visual: { layoutGrow: 0.2 } });
  const b = editor.buildElement("shape.geo", { visual: { layoutGrow: 0.4 } });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Fill",
      memberIds: [a.id, b.id],
      layout: {
        direction: "horizontal",
        gap: 0,
        padding: 0,
        sizing: "fixed",
        align: "start",
      },
    },
    visual: { width: 300, height: 100 },
  });
  editor.apply(
    [a, b, frame].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const report = inspectDesign(editor, frame.id)?.layout;
  expect(report?.css).toContain("flex: 0.5 0 0px;");
  expect(report?.css).toContain("flex: 1 0 0px;");
  expect(editor.getBounds(a.id)?.width).toBeCloseTo(100);
  expect(editor.getBounds(b.id)?.width).toBeCloseTo(200);
  expect(editor.store.get(a.id)?.visual.layoutGrow).toBe(0.2);
});

test("nested layout CSS isolates frame rules and reports class mappings", () => {
  const editor = makeEditor();
  const layout = {
    direction: "horizontal" as const,
    gap: 10,
    padding: 20,
    sizing: "fixed" as const,
    align: "start" as const,
  };
  const leaf = editor.buildElement("shape.geo");
  const child = editor.buildElement("frame", {
    semantic: {
      name: "Inner",
      memberIds: [leaf.id],
      layout: { ...layout, direction: "vertical" },
    },
  });
  const root = editor.buildElement("frame", {
    semantic: { name: "Outer", memberIds: [child.id], layout },
  });
  editor.apply(
    [leaf, child, root].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const report = inspectDesign(editor, root.id)?.layout;
  expect(report?.frames.map((frame) => frame.id)).toEqual([root.id, child.id]);
  const first = report?.frames[0];
  const second = report?.frames[1];
  expect(first?.className).not.toBe(second?.className);
  expect(report?.css).toContain(`.${first?.className} > :nth-child(1)`);
  expect(report?.css).toContain(`.${second?.className} > :nth-child(1)`);
  expect(second?.childOrder).toEqual([leaf.id]);
  expect(report?.css).not.toContain(".diagra-layout {");
});

test("frame identifiers cannot introduce CSS selector syntax", () => {
  const editor = makeEditor();
  const frame = {
    ...editor.buildElement("frame", {
      semantic: {
        name: "Untrusted",
        memberIds: [],
        layout: {
          direction: "vertical",
          gap: 0,
          padding: 0,
          sizing: "fixed",
          align: "start",
        },
      },
    }),
    id: "x} body { color:red; }/*",
  };
  editor.apply([{ type: "createElement", element: frame }]);
  const report = inspectDesign(editor, frame.id)?.layout;
  expect(report?.className).toMatch(/^diagra-layout-[a-f0-9-]+$/);
  expect(report?.css).not.toContain("body");
  expect(report?.frames[0]?.id).toBe(frame.id);
});

test("flex handoff maps explicit layout and visible child sizing without mutation", () => {
  const editor = makeEditor();
  const a = editor.buildElement("shape.geo", { visual: { layoutGrow: 2 } });
  const hidden = editor.buildElement("shape.geo", { visual: { hidden: true } });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Row",
      memberIds: [hidden.id, a.id],
      clipContent: true,
      layout: {
        direction: "horizontal",
        gap: 10,
        padding: 20,
        paddingLeft: 30,
        sizing: "fixed",
        align: "stretch",
        justify: "space-between",
      },
    },
    visual: { width: 500, height: 100 },
  });
  editor.apply(
    [a, hidden, frame].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const before = editor.getSnapshot();
  const layout = inspectDesign(editor, frame.id)?.layout;
  expect(layout?.childOrder).toEqual([a.id]);
  expect(layout?.css).toContain("flex-direction: row;");
  expect(layout?.css).toContain("padding: 20px 20px 20px 30px;");
  expect(layout?.css).toContain("justify-content: space-between;");
  expect(layout?.css).toContain("flex: 1 0 0px;");
  expect(layout?.css).toContain("height: auto;");
  expect(layout?.css).toContain("overflow: hidden;");
  expect(layout?.css).not.toContain("position: absolute");
  expect(editor.getSnapshot()).toEqual(before);
});

test("hug axes map to intrinsic dimensions and unsupported layers have no flex handoff", () => {
  const editor = makeEditor();
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Column",
      memberIds: [],
      layout: {
        direction: "vertical",
        gap: 0,
        padding: 0,
        sizing: "hug",
        widthSizing: "fixed",
        align: "start",
      },
    },
    visual: { width: 100 },
  });
  const shape = editor.buildElement("shape.geo");
  editor.apply(
    [frame, shape].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const layout = inspectDesign(editor, frame.id)?.layout;
  expect(layout?.css).toContain("flex-direction: column;");
  expect(layout?.css).toContain("width: 100px;");
  expect(layout?.css).toContain("height: max-content;");
  expect(inspectDesign(editor, shape.id)?.layout).toBeNull();
});

test("wrapped layout exports directional gaps and per-line fill", () => {
  const editor = makeEditor();
  const child = editor.buildElement("shape.geo", {
    visual: { layoutGrow: 1 },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Wrapped row",
      memberIds: [child.id],
      layout: {
        direction: "horizontal",
        gap: 8,
        crossGap: 16,
        wrap: true,
        padding: 0,
        sizing: "fixed",
        align: "start",
      },
    },
  });
  editor.apply(
    [child, frame].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const css = inspectDesign(editor, frame.id)?.layout?.css;
  expect(css).toContain("flex-wrap: wrap;");
  expect(css).toContain("column-gap: 8px;");
  expect(css).toContain("row-gap: 16px;");
  expect(css).toContain("align-content: flex-start;");
  expect(css).toContain("flex: 1 0 0px;");
});

test("layout handoff emits frame and child min/max sizing", () => {
  const editor = makeEditor();
  const child = editor.buildElement("shape.geo", {
    visual: {
      layoutGrow: 1,
      minWidth: 96,
      maxWidth: 240,
      minHeight: 44,
      maxHeight: 88,
      aspectRatio: 2,
    },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Responsive rail",
      memberIds: [child.id],
      layout: {
        direction: "horizontal",
        gap: 0,
        padding: 0,
        sizing: "fixed",
        align: "stretch",
      },
    },
    visual: {
      width: 500,
      height: 120,
      minWidth: 320,
      maxWidth: 720,
      aspectRatio: 4,
    },
  });
  editor.apply(
    [child, frame].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const css = inspectDesign(editor, frame.id)?.layout?.css;
  expect(css).toContain("min-width: 320px;");
  expect(css).toContain("max-width: 720px;");
  expect(css).toContain("min-width: 96px;");
  expect(css).toContain("max-width: 240px;");
  expect(css).toContain("min-height: 44px;");
  expect(css).toContain("max-height: 88px;");
  expect(css).toContain("aspect-ratio: 4;");
  expect(css).toContain("aspect-ratio: 2;");
  expect(css).not.toContain("height: auto;");
});

test("layout handoff keeps overlays in DOM order without consuming flex space", () => {
  const editor = makeEditor();
  const flow = editor.buildElement("shape.geo", {
    visual: { x: 20, y: 20, width: 100, height: 30 },
  });
  const overlay = editor.buildElement("shape.geo", {
    visual: {
      x: 260,
      y: 35,
      width: 24,
      height: 24,
      layoutPosition: "absolute",
      layoutGrow: 5,
    },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Overlay",
      memberIds: [flow.id, overlay.id],
      layout: {
        direction: "horizontal",
        gap: 10,
        padding: 20,
        sizing: "fixed",
        align: "start",
      },
    },
    visual: { x: 10, y: 10, width: 300, height: 100 },
  });
  editor.apply(
    [frame, flow, overlay].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const layout = inspectDesign(editor, frame.id)?.layout;
  expect(layout?.childOrder).toEqual([flow.id, overlay.id]);
  expect(layout?.css).toContain(
    "> :nth-child(2) {\n  position: absolute;\n  left: 250px;\n  top: 25px;",
  );
  expect(layout?.css).not.toContain("> :nth-child(2) {\n  position: relative;");
});
