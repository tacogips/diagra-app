import { expect, test } from "bun:test";
import { inspectDesign } from "./handoff.ts";
import { makeEditor } from "./test-helpers.ts";

test("handoff reflects edits and remains readable for locked engineering layers", () => {
  const editor = makeEditor();
  const table = editor.buildElement("erd.table");
  editor.apply([{ type: "createElement", element: table }]);
  editor.apply([
    {
      type: "updateVisual",
      id: table.id,
      visual: { x: 77, hidden: true, locked: true },
    },
  ]);
  const report = inspectDesign(editor, table.id);
  expect(report?.bounds?.x).toBe(77);
  expect(report?.semantic).toEqual(table.semantic);
  expect(report?.visual.locked).toBe(true);
  expect(report?.css).toContain("display: none;");
  editor.undo();
  expect(inspectDesign(editor, table.id)?.visual.locked).toBeUndefined();
});

test("handoff reports frame-relative geometry without mutating the document", () => {
  const editor = makeEditor();
  const frame = editor.buildElement("frame", {
    visual: { x: 100, y: 200, width: 400, height: 800 },
  });
  const node = editor.buildElement("node.generic", {
    visual: {
      x: 120,
      y: 240,
      width: 150,
      height: 50,
      aspectRatio: 3,
      style: {
        fill: "#abcdef",
        strokeCap: "round",
        strokeJoin: "miter",
        strokeMiterLimit: 9,
        strokeDashArray: [6, 2],
        strokeDashOffset: -1,
        fontSize: 16,
        lineHeight: 1.5,
        opacity: 0,
        textAlign: "middle",
      },
    },
  });
  editor.apply([
    { type: "createElement", element: frame },
    { type: "createElement", element: node },
  ]);
  editor.reparentElement(node.id, frame.id);
  const before = JSON.stringify(editor.getSnapshot());
  const revision = editor.revision;
  const report = inspectDesign(editor, node.id);
  expect(report?.parentFrame).toBe(frame.id);
  expect(report?.relativeBounds).toEqual({
    x: 20,
    y: 40,
    width: 150,
    height: 50,
  });
  expect(report?.css).toContain("left: 20px;");
  expect(report?.css).toContain("opacity: 0;");
  expect(report?.css).toContain("line-height: 1.5;");
  expect(report?.css).toContain("aspect-ratio: 3;");
  expect(report?.css).toContain("text-align: center;");
  expect(report?.css).toContain("stroke-linecap: round;");
  expect(report?.css).toContain("stroke-linejoin: miter;");
  expect(report?.css).toContain("stroke-miterlimit: 9;");
  expect(report?.css).toContain("stroke-dasharray: 6 2;");
  expect(report?.css).toContain("stroke-dashoffset: -1;");
  expect(JSON.stringify(editor.getSnapshot())).toBe(before);
  expect(editor.revision).toBe(revision);
  expect(inspectDesign(editor, "missing")).toBeNull();
});

test("handoff escapes font strings and does not emit arbitrary color declarations", () => {
  const editor = makeEditor();
  const node = editor.buildElement("node.generic", {
    visual: {
      x: 0,
      y: 0,
      style: {
        fontFamily: 'test";\n</style>',
        fill: "red; background: url(https://example.com)",
      },
    },
  });
  editor.apply([{ type: "createElement", element: node }]);
  const report = inspectDesign(editor, node.id);
  expect(report?.css).not.toContain("</style>");
  expect(report?.css).not.toContain("url(");
  expect(report?.css).toContain(
    'font-family: "test\\22 ;\\a \\3c /style\\3e ";',
  );
  expect(report?.visual.style?.fill).toBe(node.visual.style?.fill);
  expect(report?.notes.some((note) => note.includes("omitted"))).toBe(true);
});
