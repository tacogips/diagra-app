import { expect, test } from "bun:test";
import type { FillGradient } from "@diagra/ir";
import { generateMobileInterfaceCode } from "./mobile-code.ts";
import { makeEditor } from "./test-helpers.ts";

test("generates native auto-layout containers without mutating the artboard", () => {
  const editor = makeEditor();
  const label = editor.buildElement("text.note", {
    id: "welcome-label",
    semantic: { text: "Welcome" },
    visual: { x: 24, y: 32, width: 120, height: 28 },
  });
  const frame = editor.buildElement("frame", {
    id: "iphone-home",
    semantic: {
      name: "iPhone home",
      platform: "ios",
      safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
      memberIds: [label.id],
      layout: {
        direction: "vertical",
        gap: 12,
        padding: 24,
        sizing: "fixed",
        align: "center",
      },
    },
    visual: { x: 0, y: 0, width: 390, height: 844 },
  });
  editor.apply(
    [frame, label].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const before = JSON.stringify(editor.getSnapshot());
  const revision = editor.revision;
  const code = generateMobileInterfaceCode(editor, frame.id);
  expect(code?.swiftUi).toContain("struct DiagraIPhoneHomeView: View");
  expect(code?.swiftUi).toContain("VStack(alignment: .center, spacing: 12)");
  expect(code?.swiftUi).toContain(".frame(width: 390, height: 844)");
  expect(code?.jetpackCompose).toContain("fun DiagraIPhoneHomeScreen()");
  expect(code?.jetpackCompose).toContain("Column(");
  expect(code?.jetpackCompose).toContain(
    "verticalArrangement = Arrangement.spacedBy(12.dp)",
  );
  expect(code?.notes).toContainEqual(
    expect.stringContaining(
      "Design safe area (ios): top 47, right 0, bottom 34, left 0",
    ),
  );
  expect(JSON.stringify(editor.getSnapshot())).toBe(before);
  expect(editor.revision).toBe(revision);
});

test("generates native wrapping containers with independent line spacing", () => {
  const editor = makeEditor();
  const child = editor.buildElement("shape.geo", {
    visual: { layoutGrow: 1 },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Tags",
      memberIds: [child.id],
      layout: {
        direction: "horizontal",
        gap: 8,
        crossGap: 14,
        wrap: true,
        padding: 12,
        sizing: "fixed",
        align: "center",
      },
    },
  });
  editor.apply(
    [child, frame].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const code = generateMobileInterfaceCode(editor, frame.id);
  expect(code?.swiftUi).toContain(
    "DiagraFlowLayout(axis: .horizontal, itemSpacing: 8, lineSpacing: 14, crossAlignment: 0.5)",
  );
  expect(code?.swiftUi).toContain("private struct DiagraFlowLayout: Layout");
  expect(code?.swiftUi).toContain(".frame(maxWidth: .infinity)");
  expect(code?.jetpackCompose).toContain("FlowRow(");
  expect(code?.jetpackCompose).toContain(
    "@OptIn(ExperimentalLayoutApi::class)",
  );
  expect(code?.jetpackCompose).toContain(
    "verticalArrangement = Arrangement.spacedBy(14.dp)",
  );
  expect(code?.jetpackCompose).toContain(
    "itemVerticalAlignment = Alignment.CenterVertically",
  );
  expect(code?.jetpackCompose).toContain(".weight(1f)");
});

test("maps stroke geometry to SwiftUI and reports Compose border limits", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    semantic: { geo: "triangle", label: "Warning" },
    visual: {
      x: 20,
      y: 20,
      width: 120,
      height: 80,
      style: {
        stroke: "#ff0000",
        strokeWidth: 3,
        strokeCap: "square",
        strokeJoin: "bevel",
        strokeMiterLimit: 7,
      },
    },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Stroke", memberIds: [shape.id] },
    visual: { x: 0, y: 0, width: 160, height: 120 },
  });
  editor.apply([
    { type: "createElement", element: frame },
    { type: "createElement", element: shape },
  ]);
  const code = generateMobileInterfaceCode(editor, frame.id);
  expect(code?.swiftUi).toContain(
    "StrokeStyle(lineWidth: 3, lineCap: .square, lineJoin: .bevel, miterLimit: 7)",
  );
  expect(code?.notes).toContainEqual(
    expect.stringContaining("Jetpack Compose BorderStroke does not expose"),
  );
});

test("generates native min/max sizing constraints", () => {
  const editor = makeEditor();
  const child = editor.buildElement("shape.geo", {
    visual: {
      layoutGrow: 1,
      minWidth: 88,
      maxWidth: 220,
      minHeight: 44,
      maxHeight: 80,
      aspectRatio: 2,
    },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Limited row",
      memberIds: [child.id],
      layout: {
        direction: "horizontal",
        gap: 0,
        padding: 0,
        sizing: "fixed",
        align: "start",
      },
    },
    visual: { width: 390, height: 100 },
  });
  editor.apply(
    [child, frame].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const code = generateMobileInterfaceCode(editor, frame.id);
  expect(code?.swiftUi).toContain(".frame(minWidth: 88, maxWidth: 220)");
  expect(code?.swiftUi).toContain(".frame(minHeight: 44, maxHeight: 80)");
  expect(code?.jetpackCompose).toContain(".widthIn(min = 88.dp, max = 220.dp)");
  expect(code?.jetpackCompose).toContain(".heightIn(min = 44.dp, max = 80.dp)");
  expect(code?.swiftUi).toContain(".aspectRatio(2, contentMode: .fit)");
  expect(code?.jetpackCompose).toContain(".aspectRatio(2f)");
});

test("generates native overlay containers inside auto layout", () => {
  const editor = makeEditor();
  const flow = editor.buildElement("text.note", {
    semantic: { text: "Card title" },
    visual: { x: 120, y: 220, width: 180, height: 30 },
  });
  const badge = editor.buildElement("shape.geo", {
    semantic: { geo: "ellipse", label: "New" },
    visual: {
      x: 430,
      y: 230,
      width: 20,
      height: 20,
      layoutPosition: "absolute",
    },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Card",
      memberIds: [flow.id, badge.id],
      layout: {
        direction: "vertical",
        gap: 12,
        padding: 20,
        sizing: "fixed",
        align: "start",
      },
    },
    visual: { x: 100, y: 200, width: 390, height: 200 },
  });
  editor.apply(
    [frame, flow, badge].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const code = generateMobileInterfaceCode(editor, frame.id);
  expect(code?.swiftUi).toContain("ZStack(alignment: .topLeading) {");
  expect(code?.swiftUi).toContain("VStack(alignment: .leading, spacing: 12)");
  expect(code?.swiftUi).toContain(".position(x: 340, y: 40)");
  expect(code?.jetpackCompose).toContain("Box(modifier = Modifier");
  expect(code?.jetpackCompose).toContain("Column(");
  expect(code?.jetpackCompose).toContain("Modifier.matchParentSize().padding(");
  expect(code?.jetpackCompose).toContain(".offset(x = 330.dp, y = 30.dp)");
});

test("maps authored accessibility to SwiftUI and Compose semantics", () => {
  const editor = makeEditor();
  const heading = editor.buildElement("text.note", {
    semantic: { text: "Cart" },
    accessibility: {
      role: "heading",
      label: "Shopping cart",
      hint: "Review items",
      value: "2 items",
      headingLevel: 2,
      disabled: true,
    },
    visual: { x: 0, y: 0, width: 120, height: 30 },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Checkout", memberIds: [heading.id] },
    visual: { x: 0, y: 0, width: 320, height: 640 },
  });
  editor.apply(
    [frame, heading].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const code = generateMobileInterfaceCode(editor, frame.id);
  expect(code?.swiftUi).toContain('.accessibilityLabel("Shopping cart")');
  expect(code?.swiftUi).toContain('.accessibilityHint("Review items")');
  expect(code?.swiftUi).toContain('.accessibilityValue("2 items")');
  expect(code?.swiftUi).toContain(".accessibilityAddTraits(.isHeader)");
  expect(code?.swiftUi).toContain(".accessibilityHeading(.h2)");
  expect(code?.jetpackCompose).toContain(
    '.semantics { contentDescription = "Shopping cart"; stateDescription = "2 items"; heading(); disabled() }',
  );
  expect(code?.jetpackCompose).toContain(
    "import androidx.compose.ui.semantics.*",
  );
});

test("preserves absolute child geometry and native typography", () => {
  const editor = makeEditor();
  const label = editor.buildElement("text.note", {
    id: "headline",
    semantic: {
      text: 'Ship "today"',
      marks: [
        { start: 0, end: 4, kind: "bold" },
        { start: 0, end: 4, kind: "underline" },
        { start: 6, end: 11, kind: "link", href: "https://diagra.app" },
      ],
    },
    visual: {
      x: 125,
      y: 250,
      width: 180,
      height: 40,
      style: {
        color: "#123456",
        fontSize: 18,
        fontWeight: 700,
        fontStyle: "italic",
        textAlign: "end",
        letterSpacing: 0.5,
      },
    },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Checkout", memberIds: [label.id] },
    visual: { x: 100, y: 200, width: 320, height: 640 },
  });
  editor.apply(
    [frame, label].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const code = generateMobileInterfaceCode(editor, frame.id);
  expect(code?.swiftUi).toContain('Text("Ship").bold().underline()');
  expect(code?.swiftUi).toContain('(Text("Ship").bold().underline()');
  expect(code?.swiftUi).toMatch(/\(Text\("Ship"\).*\)\)\n\s+\.foregroundStyle/);
  expect(code?.swiftUi).toContain(
    'Text("today").foregroundStyle(.blue).underline()',
  );
  expect(code?.swiftUi).toContain(".position(x: 115, y: 70)");
  expect(code?.swiftUi).toContain(".fontWeight(.bold)");
  expect(code?.swiftUi).toContain(".multilineTextAlignment(.trailing)");
  expect(code?.jetpackCompose).toContain(".offset(x = 25.dp, y = 50.dp)");
  expect(code?.jetpackCompose).toContain("fontWeight = FontWeight(700)");
  expect(code?.jetpackCompose).toContain("fontStyle = FontStyle.Italic");
  expect(code?.jetpackCompose).toContain("textAlign = TextAlign.End");
  expect(code?.jetpackCompose).toContain("buildAnnotatedString {");
  expect(code?.jetpackCompose).toContain(
    'addStringAnnotation(tag = "URL", annotation = "https://diagra.app", start = 6, end = 11)',
  );
});

test("generates exact normalized image crop transforms and asset references", () => {
  const editor = makeEditor();
  const image = editor.buildElement("image.raster", {
    id: "Hero-Image",
    semantic: {
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      alt: "Product hero",
      crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.5 },
    },
    visual: { x: 20, y: 40, width: 320, height: 180 },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Landing", memberIds: [image.id] },
    visual: { x: 0, y: 0, width: 390, height: 844 },
  });
  editor.apply(
    [frame, image].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const code = generateMobileInterfaceCode(editor, frame.id);
  expect(code?.swiftUi).toContain(".frame(width: 400, height: 360)");
  expect(code?.swiftUi).toContain(".offset(x: -40, y: -72)");
  expect(code?.jetpackCompose).toContain(".offset(x = -40.dp, y = -72.dp)");
  expect(code?.jetpackCompose).toContain(".size(400.dp, 360.dp)");
  expect(code?.assets).toEqual([
    {
      elementId: image.id,
      resourceName: "diagra_hero_image",
      mediaType: "image/png",
    },
  ]);
});

test("maps native gradients and reports platform-specific fallbacks", () => {
  const angular: FillGradient = {
    type: "angular",
    centerX: 0.25,
    centerY: 0.75,
    angle: 30,
    stops: [
      { offset: 0, color: "#112233" },
      { offset: 1, color: "#abcdef", opacity: 0.5 },
    ],
  };
  const diamond: FillGradient = {
    type: "diamond",
    centerX: 0.5,
    centerY: 0.5,
    radius: 0.75,
    angle: 45,
    stops: angular.stops,
  };
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    semantic: { geo: "rect", label: "Gradient card" },
    visual: {
      x: 10,
      y: 10,
      width: 200,
      height: 100,
      style: {
        fill: "#112233",
        fillGradient: angular,
        stroke: "#abcdef",
        strokeGradient: diamond,
        strokeWidth: 2,
      },
    },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Effects", memberIds: [shape.id] },
    visual: { x: 0, y: 0, width: 240, height: 140 },
  });
  editor.apply(
    [frame, shape].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const code = generateMobileInterfaceCode(editor, frame.id);
  expect(code?.swiftUi).toContain("AngularGradient(");
  expect(code?.jetpackCompose).toContain("Brush.sweepGradient(");
  expect(code?.notes).toContain(
    "Diamond gradients use their first stop as a native-code fallback.",
  );
  expect(code?.notes.at(-1)).toContain("custom shader");
});

test("shares hidden and connector exclusions with web code generation", () => {
  const editor = makeEditor();
  const visible = editor.buildElement("node.generic", {
    id: "visible-card",
    semantic: { label: "Visible" },
    visual: { x: 10, y: 10, width: 100, height: 40 },
  });
  const hidden = editor.buildElement("node.generic", {
    id: "secret-card",
    semantic: { label: "Secret" },
    visual: { x: 10, y: 60, width: 100, height: 40, hidden: true },
  });
  const connector = editor.buildElement("edge.generic", {
    id: "prototype-link",
    semantic: { from: visible.id, to: visible.id, prototype: true },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Filtered",
      memberIds: [visible.id, connector.id, hidden.id],
    },
    visual: { x: 0, y: 0, width: 320, height: 640 },
  });
  editor.apply(
    [frame, visible, hidden, connector].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const code = generateMobileInterfaceCode(editor, frame.id);
  expect(code?.swiftUi).toContain("Visible");
  expect(code?.swiftUi).not.toContain("Secret");
  expect(code?.swiftUi).not.toContain("prototype-link");
  expect(code?.jetpackCompose).not.toContain("Secret");
  expect(generateMobileInterfaceCode(editor, visible.id)).toBeNull();
});

test("generates native convex group masks without painting the mask source", () => {
  const editor = makeEditor();
  const mask = editor.buildElement("shape.geo", {
    id: "avatar-mask",
    semantic: { geo: "diamond" },
    visual: { x: 20, y: 20, width: 100, height: 100 },
  });
  const content = editor.buildElement("shape.geo", {
    id: "avatar-content",
    semantic: { geo: "rect", label: "Avatar" },
    visual: { x: 0, y: 0, width: 140, height: 140 },
  });
  const group = editor.buildElement("group", {
    id: "avatar-group",
    semantic: {
      memberIds: [mask.id, content.id],
      maskId: mask.id,
    },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Profile", memberIds: [group.id] },
    visual: { x: 0, y: 0, width: 390, height: 844 },
  });
  editor.apply(
    [frame, group, mask, content].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const code = generateMobileInterfaceCode(editor, frame.id);
  expect(code?.swiftUi).toContain(".mask(DiagraPolygon(points:");
  expect(code?.jetpackCompose).toContain(".clip(GenericShape");
  expect(code?.swiftUi).not.toContain("avatar-mask");
  expect(code?.jetpackCompose).not.toContain("avatar-mask");
  expect(code?.swiftUi).toContain("Avatar");
  expect(code?.jetpackCompose).toContain("Avatar");
});
