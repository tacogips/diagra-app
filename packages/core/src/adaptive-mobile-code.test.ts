import { expect, test } from "bun:test";
import { generateAdaptiveMobileInterfaceCode } from "./mobile-code.ts";
import { makeEditor } from "./test-helpers.ts";

function occurrences(source: string | undefined, value: string): number {
  return source ? source.split(value).length - 1 : 0;
}

test("generates one valid adaptive native family with unique symbols", () => {
  const editor = makeEditor();
  const frames = [
    editor.buildElement("frame", {
      id: "desktop",
      semantic: { name: "Checkout", platform: "web" },
      visual: { width: 1440, height: 900 },
    }),
    editor.buildElement("frame", {
      id: "tablet",
      semantic: {
        name: "Checkout",
        platform: "android",
        responsiveSource: "desktop",
      },
      visual: { x: 1520, width: 768, height: 1024 },
    }),
    editor.buildElement("frame", {
      id: "mobile",
      semantic: {
        name: "Checkout",
        platform: "ios",
        responsiveSource: "tablet",
      },
      visual: { x: 2368, width: 390, height: 844 },
    }),
  ];
  editor.apply(
    frames.map((element) => ({ type: "createElement" as const, element })),
  );
  const before = editor.getSnapshot();

  const report = generateAdaptiveMobileInterfaceCode(editor, "tablet");
  expect(report?.sourceRootId).toBe("desktop");
  expect(
    report?.breakpoints.map(({ rootId, width }) => ({ rootId, width })),
  ).toEqual([
    { rootId: "mobile", width: 390 },
    { rootId: "tablet", width: 768 },
    { rootId: "desktop", width: 1440 },
  ]);
  expect(
    new Set(report?.breakpoints.map((item) => item.swiftViewName)).size,
  ).toBe(3);
  expect(
    new Set(report?.breakpoints.map((item) => item.composeFunctionName)).size,
  ).toBe(3);
  expect(occurrences(report?.swiftUi, "import SwiftUI")).toBe(1);
  expect(occurrences(report?.swiftUi, "private struct DiagraPolygon")).toBe(1);
  expect(report?.swiftUi).toContain("if proxy.size.width >= 1440");
  expect(report?.swiftUi).toContain("} else if proxy.size.width >= 768 {");
  expect(report?.swiftUi).toContain("} else {");
  expect(
    occurrences(report?.jetpackCompose, "import androidx.compose"),
  ).toBeGreaterThan(10);
  expect(
    occurrences(
      report?.jetpackCompose,
      "import androidx.compose.foundation.BorderStroke",
    ),
  ).toBe(1);
  expect(report?.jetpackCompose).toContain("BoxWithConstraints {");
  expect(report?.jetpackCompose).toContain("maxWidth >= 1440.dp");
  expect(report?.jetpackCompose).toContain("maxWidth >= 768.dp");
  expect(report?.jetpackCompose).toContain("else -> DiagraBreakpoint");
  const manifest = JSON.parse(report?.manifest ?? "{}") as {
    breakpoints?: { platform?: string; manifest?: { root?: string } }[];
    swiftDispatcher?: string;
    composeDispatcher?: string;
  };
  expect(manifest.breakpoints?.map((item) => item.platform)).toEqual([
    "ios",
    "android",
    "web",
  ]);
  expect(manifest.breakpoints?.map((item) => item.manifest?.root)).toEqual([
    "mobile",
    "tablet",
    "desktop",
  ]);
  expect(manifest.swiftDispatcher).toMatch(/^DiagraAdaptive.+View$/);
  expect(manifest.composeDispatcher).toMatch(/^DiagraAdaptive.+Screen$/);
  expect(editor.getSnapshot()).toEqual(before);
});

test("shares duplicate-width decisions with responsive web handoff", () => {
  const editor = makeEditor();
  const source = editor.buildElement("frame", {
    id: "source",
    semantic: { name: "Source" },
    visual: { width: 800, height: 600 },
  });
  const first = editor.buildElement("frame", {
    id: "a-first",
    semantic: { name: "First", responsiveSource: source.id },
    visual: { x: 900, width: 400, height: 600 },
  });
  const duplicate = editor.buildElement("frame", {
    id: "b-second",
    semantic: { name: "Second", responsiveSource: source.id },
    visual: { x: 1400, width: 400, height: 600 },
  });
  editor.apply(
    [source, first, duplicate].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const report = generateAdaptiveMobileInterfaceCode(editor, duplicate.id);
  expect(report?.breakpoints.map((item) => item.rootId)).toEqual([
    first.id,
    source.id,
  ]);
  expect(report?.notes).toContain(
    `${duplicate.id}: duplicate 400px breakpoint was omitted; viewport widths must be unique.`,
  );
  expect(report?.manifest).toContain("duplicate 400px breakpoint was omitted");
});
