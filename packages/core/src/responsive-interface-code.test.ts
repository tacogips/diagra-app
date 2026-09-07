import { expect, test } from "bun:test";
import { generateResponsiveInterfaceCode } from "./responsive-interface-code.ts";
import { makeEditor } from "./test-helpers.ts";

test("generates deterministic media branches for a transitive responsive family", () => {
  const editor = makeEditor();
  const desktopText = editor.buildElement("text.note", {
    id: "desktop-copy",
    semantic: { text: "Desktop checkout" },
    visual: { x: 20, y: 20, width: 400, height: 40 },
  });
  const tabletText = editor.buildElement("text.note", {
    id: "tablet-copy",
    semantic: { text: "Tablet checkout" },
    visual: { x: 1540, y: 20, width: 300, height: 40 },
  });
  const mobileText = editor.buildElement("text.note", {
    id: "mobile-copy",
    semantic: { text: "Mobile checkout" },
    visual: { x: 2388, y: 20, width: 300, height: 40 },
  });
  const desktop = editor.buildElement("frame", {
    id: "desktop",
    semantic: {
      name: "Checkout desktop",
      platform: "web",
      memberIds: [desktopText.id],
    },
    visual: { x: 0, y: 0, width: 1440, height: 900 },
  });
  const tablet = editor.buildElement("frame", {
    id: "tablet",
    semantic: {
      name: "Checkout tablet",
      platform: "web",
      responsiveSource: desktop.id,
      memberIds: [tabletText.id],
    },
    visual: { x: 1520, y: 0, width: 768, height: 1024 },
  });
  const mobile = editor.buildElement("frame", {
    id: "mobile",
    semantic: {
      name: "Checkout mobile",
      platform: "ios",
      responsiveSource: tablet.id,
      memberIds: [mobileText.id],
    },
    visual: { x: 2368, y: 0, width: 390, height: 844 },
  });
  editor.apply(
    [desktop, desktopText, tablet, tabletText, mobile, mobileText].map(
      (element) => ({ type: "createElement" as const, element }),
    ),
  );

  const before = editor.getSnapshot();
  const report = generateResponsiveInterfaceCode(editor, tablet.id);
  expect(report?.sourceRootId).toBe(desktop.id);
  expect(
    report?.breakpoints.map(({ rootId, width }) => ({ rootId, width })),
  ).toEqual([
    { rootId: mobile.id, width: 390 },
    { rootId: tablet.id, width: 768 },
    { rootId: desktop.id, width: 1440 },
  ]);
  expect(report?.html).toContain("Mobile checkout");
  expect(report?.html).toContain("Tablet checkout");
  expect(report?.html).toContain("Desktop checkout");
  expect(report?.css).toContain(
    ".diagra-breakpoint-6d-6f-62-69-6c-65 { display: block; }",
  );
  expect(report?.css).toContain("@media (min-width: 768px)");
  expect(report?.css).toContain("@media (min-width: 1440px)");
  expect(report?.css).not.toContain("max-width");
  expect(report?.linkedCss).toContain(".diagra-responsive-view");
  expect(JSON.parse(report?.manifest ?? "{}")).toMatchObject({
    sourceRoot: desktop.id,
    breakpoints: [
      {
        rootId: mobile.id,
        name: "Checkout mobile",
        platform: "ios",
        width: 390,
      },
      {
        rootId: tablet.id,
        name: "Checkout tablet",
        platform: "web",
        width: 768,
      },
      {
        rootId: desktop.id,
        name: "Checkout desktop",
        platform: "web",
        width: 1440,
      },
    ],
  });
  expect(editor.getSnapshot()).toEqual(before);
});

test("reports and deterministically omits duplicate viewport widths", () => {
  const editor = makeEditor();
  const source = editor.buildElement("frame", {
    id: "source",
    semantic: { name: "Source" },
    visual: { width: 800, height: 600 },
  });
  const first = editor.buildElement("frame", {
    id: "a-duplicate",
    semantic: { name: "First", responsiveSource: source.id },
    visual: { x: 900, width: 400, height: 600 },
  });
  const second = editor.buildElement("frame", {
    id: "b-duplicate",
    semantic: { name: "Second", responsiveSource: source.id },
    visual: { x: 1400, width: 400, height: 600 },
  });
  editor.apply(
    [source, first, second].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const report = generateResponsiveInterfaceCode(editor, second.id);
  expect(report?.breakpoints.map((breakpoint) => breakpoint.rootId)).toEqual([
    first.id,
    source.id,
  ]);
  expect(report?.notes).toContain(
    `${second.id}: duplicate 400px breakpoint was omitted; viewport widths must be unique.`,
  );
});

test("returns null for non-artboard selections", () => {
  const editor = makeEditor();
  const shape = editor.createElement("shape.geo");
  expect(generateResponsiveInterfaceCode(editor, shape)).toBeNull();
  expect(generateResponsiveInterfaceCode(editor, "missing")).toBeNull();
});
