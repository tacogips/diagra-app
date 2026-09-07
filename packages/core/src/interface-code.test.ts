import { expect, test } from "bun:test";
import { bindSelectionColor, createColorToken } from "./color-tokens.ts";
import { generateInterfaceCode } from "./interface-code.ts";
import { makeEditor } from "./test-helpers.ts";

test("generates escaped nested HTML and flex CSS without mutating the artboard", () => {
  const editor = makeEditor();
  const text = editor.buildElement("text.note", {
    id: "label/<unsafe>",
    semantic: { text: "Save <draft> & continue" },
    visual: {
      x: 120,
      y: 220,
      width: 180,
      height: 40,
      style: {
        color: "#112233",
        fontSize: 16,
        strokeCap: "round",
        strokeJoin: "bevel",
        strokeMiterLimit: 5,
      },
    },
  });
  const frame = editor.buildElement("frame", {
    id: "screen/home",
    semantic: {
      name: 'Home "mobile"',
      platform: "ios",
      safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
      memberIds: [text.id],
      layout: {
        direction: "horizontal",
        gap: 12,
        padding: 20,
        sizing: "fixed",
        align: "center",
      },
    },
    visual: { x: 100, y: 200, width: 390, height: 844 },
  });
  editor.apply(
    [frame, text].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const before = JSON.stringify(editor.getSnapshot());
  const revision = editor.revision;
  const code = generateInterfaceCode(editor, frame.id);
  expect(code?.html).toContain('aria-label="Home &quot;mobile&quot;"');
  expect(code?.html).toContain('data-platform="ios"');
  expect(code?.html).toContain("Save &lt;draft&gt; &amp; continue");
  expect(code?.html).toContain("continue</p>");
  expect(code?.html).not.toContain("label/<unsafe>");
  expect(code?.html).toContain('data-diagra-id="label/&lt;unsafe&gt;"');
  expect(code?.css).toContain("display: flex;");
  expect(code?.css).toContain("flex-direction: row;");
  expect(code?.css).toContain("color: #112233;");
  expect(code?.css).toContain("font-size: 16px;");
  expect(code?.css).toContain("stroke-linecap: round;");
  expect(code?.css).toContain("stroke-linejoin: bevel;");
  expect(code?.css).toContain("stroke-miterlimit: 5;");
  expect(code?.css).toContain("--diagra-safe-area-top: 47px;");
  expect(code?.css).toContain("--diagra-safe-area-bottom: 34px;");
  expect(code?.notes).toContainEqual(
    expect.stringContaining("Safe-area insets"),
  );
  expect(code?.notes).toContainEqual(
    expect.stringContaining("HTML border boxes cannot reproduce"),
  );
  expect(code?.css).not.toContain("left: 20px;");
  expect(JSON.stringify(editor.getSnapshot())).toBe(before);
  expect(editor.revision).toBe(revision);
});

test("maps authored accessibility to escaped HTML ARIA and the manifest", () => {
  const editor = makeEditor();
  const button = editor.buildElement("text.note", {
    semantic: { text: "Buy" },
    accessibility: {
      role: "button",
      label: 'Buy "now" <fast>',
      hint: "Adds & continues",
      value: "Ready",
      disabled: true,
    },
    visual: { x: 0, y: 0, width: 100, height: 40 },
  });
  const decorative = editor.buildElement("shape.geo", {
    semantic: { geo: "rect", label: "Sparkle" },
    accessibility: { decorative: true, label: "Ignored" },
    visual: { x: 0, y: 50, width: 20, height: 20 },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Store", memberIds: [button.id, decorative.id] },
    accessibility: { role: "main" },
    visual: { x: 0, y: 0, width: 320, height: 640 },
  });
  editor.apply(
    [frame, button, decorative].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const code = generateInterfaceCode(editor, frame.id);
  expect(code?.html).toContain('role="button"');
  expect(code?.html).toContain('role="main"');
  expect(code?.html).toContain('aria-label="Store"');
  expect(code?.html).toContain('aria-label="Buy &quot;now&quot; &lt;fast&gt;"');
  expect(code?.html).toContain(
    'aria-description="Adds &amp; continues Current value: Ready"',
  );
  expect(code?.html).not.toContain("aria-valuetext");
  expect(code?.html).toContain('aria-disabled="true"');
  expect(code?.html).toContain('aria-hidden="true"');
  expect(code?.html).not.toContain('aria-label="Ignored"');
  expect(code?.manifest).toContain('"accessibility"');
});

test("keeps absolute geometry and CSS shape outlines outside auto layout", () => {
  const editor = makeEditor();
  const shape = editor.buildElement("shape.geo", {
    semantic: { geo: "ellipse", label: "Avatar" },
    visual: { x: 125, y: 250, width: 80, height: 80 },
  });
  const hidden = editor.buildElement("node.generic", {
    id: "private-note",
    semantic: { label: "Do not generate" },
    visual: { x: 200, y: 250, width: 80, height: 40, hidden: true },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Profile", memberIds: [shape.id, hidden.id] },
    visual: { x: 100, y: 200, width: 390, height: 844 },
  });
  editor.apply(
    [frame, shape, hidden].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const code = generateInterfaceCode(editor, frame.id);
  expect(code?.html).toContain(">Avatar</div>");
  expect(code?.css).toContain("position: absolute;");
  expect(code?.css).toContain("left: 25px;");
  expect(code?.css).toContain("top: 50px;");
  expect(code?.css).toContain("border-radius: 50%;");
  expect(code?.html).not.toContain("Do not generate");
  const manifest = JSON.parse(code?.manifest ?? "{}") as {
    elements?: { id?: string }[];
  };
  expect(manifest.elements?.some((element) => element.id === hidden.id)).toBe(
    false,
  );
});

test("keeps authored overlays absolute inside generated auto layout", () => {
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
  const code = generateInterfaceCode(editor, frame.id);
  expect(code?.css).toContain("display: flex;");
  expect(code?.css).toContain("position: absolute;");
  expect(code?.css).toContain("left: 330px;");
  expect(code?.css).toContain("top: 30px;");
  expect(code?.css).toContain("position: relative;");
  expect(code?.html.indexOf("Card title")).toBeLessThan(
    code?.html.indexOf(">New</div>") ?? -1,
  );
});

test("preserves group nesting and discovers auto layout below a non-layout root", () => {
  const editor = makeEditor();
  const text = editor.buildElement("text.note", {
    id: "nested-label",
    semantic: { text: "Nested" },
    visual: { x: 150, y: 150, width: 100, height: 24 },
  });
  const nested = editor.buildElement("frame", {
    id: "nested-row",
    semantic: {
      name: "Row",
      memberIds: [text.id],
      layout: {
        direction: "horizontal",
        gap: 8,
        padding: 12,
        sizing: "hug",
        align: "center",
      },
    },
    visual: { x: 138, y: 138, width: 124, height: 48 },
  });
  const group = editor.buildElement("group", {
    id: "content-group",
    semantic: { memberIds: [nested.id] },
  });
  const root = editor.buildElement("frame", {
    id: "plain-root",
    semantic: { name: "Plain", memberIds: [group.id] },
    visual: { x: 100, y: 100, width: 320, height: 640 },
  });
  editor.apply(
    [root, group, nested, text].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const code = generateInterfaceCode(editor, root.id);
  const groupAt = code?.html.indexOf('data-diagra-id="content-group"') ?? -1;
  const rowAt = code?.html.indexOf('data-diagra-id="nested-row"') ?? -1;
  const textAt = code?.html.indexOf('data-diagra-id="nested-label"') ?? -1;
  expect(groupAt).toBeGreaterThan(-1);
  expect(rowAt).toBeGreaterThan(groupAt);
  expect(textAt).toBeGreaterThan(rowAt);
  expect(code?.html).toContain("diagra-layout-");
  expect(code?.css).toContain("flex-direction: row;");
  expect(code?.css).toContain("height: max-content;");
});

test("generates embedded image crop CSS and a semantic manifest", () => {
  const editor = makeEditor();
  const image = editor.buildElement("image.raster", {
    id: "hero",
    semantic: {
      src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      alt: 'Hero "preview"',
      crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
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
  const code = generateInterfaceCode(editor, frame.id);
  expect(code?.html).toContain('alt="Hero &quot;preview&quot;"');
  expect(code?.css).toContain("left: -12.5000%;");
  expect(code?.css).toContain("top: -28.5714%;");
  expect(code?.css).toContain("width: 125.0000%;");
  expect(code?.manifest).toContain('"type": "image.raster"');
  expect(code?.manifest).toContain('"width": 0.8');
});

test("linked output includes portable palette variables and reports omitted connectors", () => {
  const editor = makeEditor();
  const child = editor.buildElement("node.generic", {
    id: "button",
    semantic: { label: "Submit" },
    visual: { x: 20, y: 20, width: 120, height: 40 },
  });
  const edge = editor.buildElement("edge.generic", {
    id: "prototype-link",
    semantic: { from: child.id, to: child.id, prototype: true },
  });
  const frame = editor.buildElement("frame", {
    semantic: {
      name: "Form",
      memberIds: [edge.id, child.id],
      layout: {
        direction: "vertical",
        gap: 8,
        padding: 16,
        sizing: "fixed",
        align: "stretch",
      },
    },
    visual: { x: 0, y: 0, width: 320, height: 640 },
  });
  editor.apply(
    [frame, child, edge].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  editor.selection.set([child.id]);
  const token = createColorToken(editor, "Brand primary", "#2563eb");
  if (!token) throw new Error("missing token");
  bindSelectionColor(editor, "fill", token);
  const code = generateInterfaceCode(editor, frame.id);
  expect(code?.linkedCss).toContain(":root {");
  expect(code?.linkedCss).toContain("var(--diagra-color-");
  expect(code?.html).not.toContain("prototype-link");
  expect(code?.css).toContain(":nth-child(1)");
  expect(code?.css).not.toContain(":nth-child(2)");
  expect(code?.manifest).toContain('"omitted": [');
  expect(code?.manifest).toContain('"prototype-link"');
  expect(code?.manifest).toContain('"prototype": true');
  expect(code?.notes.at(-1)).toContain("prototype-link");
  expect(generateInterfaceCode(editor, child.id)).toBeNull();
});

test("generated HTML preserves safe rich-text marks and neutralizes unsafe links", () => {
  const editor = makeEditor();
  const text = editor.buildElement("text.note", {
    id: "rich-copy",
    semantic: {
      text: "Bold code safe bad",
      marks: [
        { start: 0, end: 4, kind: "bold" },
        { start: 5, end: 9, kind: "code" },
        { start: 10, end: 14, kind: "link", href: "https://diagra.app/docs" },
        { start: 15, end: 18, kind: "link", href: "javascript:alert(1)" },
      ],
    },
    visual: { x: 20, y: 20, width: 240, height: 40 },
  });
  const frame = editor.buildElement("frame", {
    semantic: { name: "Rich", memberIds: [text.id] },
    visual: { x: 0, y: 0, width: 320, height: 640 },
  });
  editor.apply(
    [frame, text].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const code = generateInterfaceCode(editor, frame.id);
  expect(code?.html).toContain("<strong>Bold</strong>");
  expect(code?.html).toContain("<code>code</code>");
  expect(code?.html).toContain(
    '<a href="https://diagra.app/docs" rel="noopener noreferrer">safe</a>',
  );
  expect(code?.html).not.toContain("javascript:");
  expect(code?.notes.at(-1)).toContain("Unsafe rich-text link protocols");
});
