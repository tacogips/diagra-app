// SVG export: the file the desktop app writes.
//
// The assertions are deliberately about the contract rather than the exact
// bytes — layer order, viewBox, escaping, marker defs, style mapping — so
// the exporter can be tuned without rewriting the suite, but a regression in
// any of the promises the format makes still fails.

import { describe, expect, test } from "bun:test";
import { type Element, GEO_KINDS } from "@diagra/ir";
import { createShapeContext } from "./hit-test.ts";
import { createDefaultRegistry } from "./shapes/index.ts";
import { Store } from "./store.ts";
import {
  DEFAULT_SVG_THEME,
  escapeXml,
  renderElementsSvg,
  renderPageSvg,
  renderSelectionSvg,
  wrapTextLines,
} from "./svg-export.ts";
import {
  document,
  element,
  erdFixture,
  makeEditor,
  TEST_PAGE,
} from "./test-helpers.ts";

const registry = createDefaultRegistry();

function pageSvg(elements: Parameters<typeof document>[0]): string {
  const store = new Store(document(elements));
  const svg = renderPageSvg(store, registry, TEST_PAGE.id);
  if (svg === null) {
    throw new Error("expected an svg");
  }
  return svg;
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const geo = (id: string, kind: string, extra: Record<string, unknown> = {}) =>
  element({
    id,
    type: "shape.geo",
    index: "b1",
    semantic: { geo: kind, label: "" },
    visual: { x: 0, y: 0, width: 160, height: 100, ...extra },
  });

describe("escapeXml", () => {
  test("escapes the five predefined entities", () => {
    expect(escapeXml(`a<b>&"c'`)).toBe("a&lt;b&gt;&amp;&quot;c&apos;");
  });

  test("escapes ampersands before the entities it introduces", () => {
    expect(escapeXml("&lt;")).toBe("&amp;lt;");
  });
});

describe("document shape", () => {
  test("starts with a namespaced svg root carrying the base type", () => {
    const svg = pageSvg([geo("g", "rect")]);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(
      true,
    );
    expect(svg).toContain(`font-family="${DEFAULT_SVG_THEME.fontFamily}"`);
    expect(svg).toContain(`font-size="${DEFAULT_SVG_THEME.fontSize}"`);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  test("the viewBox is the content bounds plus the padding", () => {
    const svg = pageSvg([geo("g", "rect")]);
    expect(svg).toContain('viewBox="-16 -16 192 132"');
    expect(svg).toContain('width="192"');
    expect(svg).toContain('height="132"');
  });

  test("the padding is configurable", () => {
    const store = new Store(document([geo("g", "rect")]));
    const svg = renderPageSvg(store, registry, TEST_PAGE.id, { padding: 0 });
    expect(svg).toContain('viewBox="0 0 160 100"');
  });

  test("a background is painted only when one is asked for", () => {
    const store = new Store(document([geo("g", "rect")]));
    expect(renderPageSvg(store, registry, TEST_PAGE.id)).not.toContain(
      'fill="#ffffff"',
    );
    const painted = renderPageSvg(store, registry, TEST_PAGE.id, {
      background: "#ffffff",
    }) as string;
    expect(painted).toContain('<rect x="-16" y="-16"');
    expect(painted).toContain('fill="#ffffff"');
  });

  test("the theme can be overridden field by field", () => {
    const store = new Store(document([geo("g", "rect")]));
    const svg = renderPageSvg(store, registry, TEST_PAGE.id, {
      theme: { ink: "#000000" },
    }) as string;
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain(`font-family="${DEFAULT_SVG_THEME.fontFamily}"`);
  });

  test("connectors are laid down before the shapes they join", () => {
    const svg = pageSvg([...erdFixture()]);
    expect(svg.indexOf('data-layer="connectors"')).toBeGreaterThanOrEqual(0);
    expect(svg.indexOf('data-layer="connectors"')).toBeLessThan(
      svg.indexOf('data-layer="shapes"'),
    );
  });

  test("each element is wrapped in a group naming it", () => {
    const svg = pageSvg([...erdFixture()]);
    expect(svg).toContain('<g data-id="users" data-type="erd.table">');
    expect(svg).toContain('<g data-id="rel" data-type="erd.relation">');
  });

  test("every marker is defined exactly once", () => {
    const svg = pageSvg([...erdFixture()]);
    for (const id of [
      "diagra-arrow",
      "diagra-triangle",
      "diagra-diamond-open",
      "diagra-diamond-filled",
      "diagra-dot",
    ]) {
      expect(occurrences(svg, `<marker id="${id}"`)).toBe(1);
    }
  });

  test("an empty page exports nothing at all", () => {
    const store = new Store(document([]));
    expect(renderPageSvg(store, registry, TEST_PAGE.id)).toBeNull();
    expect(renderPageSvg(store, registry, "no-such-page")).toBeNull();
  });

  test("two exports of one document are byte-identical", () => {
    const store = new Store(document([...erdFixture(), geo("g", "star")]));
    expect(renderPageSvg(store, registry, TEST_PAGE.id)).toBe(
      renderPageSvg(store, registry, TEST_PAGE.id) as string,
    );
  });
});

describe("elements", () => {
  test("each geo kind renders as its own primitive", () => {
    const expected: Record<string, string> = {
      rect: "<rect",
      ellipse: "<ellipse",
      diamond: "<polygon",
      triangle: "<polygon",
      hexagon: "<polygon",
      parallelogram: "<polygon",
      cylinder: "<path",
      star: "<polygon",
    };
    for (const kind of GEO_KINDS) {
      const svg = pageSvg([geo("g", kind)]);
      const body = svg.slice(svg.indexOf('data-layer="shapes"'));
      expect(body).toContain(expected[kind] as string);
    }
  });

  test("a geo label is drawn centred and escaped", () => {
    const svg = pageSvg([
      element({
        id: "g",
        type: "shape.geo",
        semantic: { geo: "rect", label: `a<b>&"c'` },
        visual: { x: 0, y: 0, width: 160, height: 100 },
      }),
    ]);
    expect(svg).toContain(">a&lt;b&gt;&amp;&quot;c&apos;</text>");
    expect(svg).toContain('x="80" y="50" text-anchor="middle"');
  });

  test("an erd table draws its header, keys, names and types", () => {
    const svg = pageSvg([...erdFixture()]);
    expect(svg).toContain(">users</text>");
    expect(svg).toContain(">PK</text>");
    expect(svg).toContain(">uuid</text>");
    expect(svg).toContain(`fill="${DEFAULT_SVG_THEME.accentSoft}"`);
  });

  test("an erd table exports unique and ordinary index badges", () => {
    const svg = pageSvg([
      element({
        id: "indexed",
        type: "erd.table",
        semantic: {
          tableName: "events",
          columns: [
            { id: "slug", name: "slug", dataType: "text" },
            { id: "created", name: "created_at", dataType: "timestamp" },
          ],
          indexes: [
            { id: "slug-uq", columns: ["slug"], unique: true },
            { id: "timeline", columns: ["created"] },
          ],
        },
        visual: { x: 0, y: 0, width: 240 },
      }),
    ]);
    expect(svg).toContain(">UQ</text>");
    expect(svg).toContain(">IX</text>");
  });

  test("a uml class draws its bands, stereotype and member rows", () => {
    const svg = pageSvg([
      element({
        id: "c",
        type: "uml.class",
        semantic: {
          name: "Repo",
          stereotype: "interface",
          attributes: [{ id: "a", name: "size", type: "int", static: true }],
          methods: [
            {
              id: "m",
              name: "find",
              parameters: [{ name: "id", type: "string" }],
              returnType: "Row",
              abstract: true,
            },
          ],
        },
        visual: { x: 0, y: 0, width: 200 },
      }),
    ]);
    expect(svg).toContain(">«interface»</text>");
    expect(svg).toContain(">Repo</text>");
    expect(svg).toContain('text-decoration="underline"');
    expect(svg).toContain(">+ size: int</text>");
    expect(svg).toContain('font-style="italic"');
    expect(svg).toContain(">+ find(id: string): Row</text>");
  });

  test("a relation carries its dot markers and cardinality", () => {
    const svg = pageSvg([...erdFixture()]);
    expect(svg).toContain('marker-start="url(#diagra-dot)"');
    expect(svg).toContain('marker-end="url(#diagra-dot)"');
    expect(svg).toContain(">1:*</text>");
  });

  test("a sequence diagram draws participant lifelines, messages and activations", () => {
    const svg = pageSvg([
      element({
        id: "user",
        type: "sequence.participant",
        semantic: { name: "User", kind: "actor", order: "a1" },
        visual: { x: 0, y: 0, width: 120, height: 260 },
      }),
      element({
        id: "api",
        index: "a2",
        type: "sequence.participant",
        semantic: { name: "API", kind: "service", order: "a2" },
        visual: { x: 280, y: 0, width: 120, height: 260 },
      }),
      element({
        id: "call",
        index: "a3",
        type: "sequence.message",
        semantic: {
          from: "user",
          to: "api",
          order: "b1",
          kind: "sync",
          label: "Request",
        },
        visual: { y: 130 },
      }),
      element({
        id: "return",
        index: "a4",
        type: "sequence.message",
        semantic: {
          from: "api",
          to: "user",
          order: "b2",
          kind: "return",
          label: "Response",
        },
        visual: { y: 182 },
      }),
      element({
        id: "active",
        index: "a5",
        type: "sequence.activation",
        semantic: { participant: "api", fromOrder: "b1", toOrder: "b2" },
        visual: { x: 335, y: 130, width: 10, height: 52 },
      }),
    ]);
    expect(svg).toContain(
      '<g data-id="user" data-type="sequence.participant">',
    );
    expect(svg).toContain('stroke-dasharray="5 4"');
    expect(svg).toContain('data-id="call" data-type="sequence.message"');
    expect(svg).toContain(">Request</text>");
    expect(svg).toContain(
      '<g data-id="return" data-type="sequence.message"><line x1="340" y1="182" x2="60" y2="182" fill="none" stroke="#1d2a2e" stroke-width="1.5" marker-end="url(#diagra-arrow)" stroke-dasharray="6 4" />',
    );
    expect(svg).toContain(
      '<g data-id="active" data-type="sequence.activation">',
    );
  });

  test("a text note draws its lines from the top, left aligned", () => {
    const svg = pageSvg([
      element({
        id: "t",
        type: "text.note",
        semantic: { text: "hello world\nsecond" },
        visual: { x: 0, y: 0, width: 200, height: 60 },
      }),
    ]);
    expect(svg).toContain('<g data-id="t" data-type="text.note">');
    expect(svg).toContain(">hello world</text>");
    expect(svg).toContain(">second</text>");
    expect(svg).toContain('x="8"');
    expect(svg).toContain('text-anchor="start"');
    // Line height is 1.2 times the 13 unit theme font: first line centred
    // at 6 + 7.8, the second one line further down.
    expect(svg).toContain('y="13.8"');
    expect(svg).toContain('y="29.4"');
    expect(svg).not.toContain("<rect");
  });

  test("a text note wraps long text to its width", () => {
    const svg = pageSvg([
      element({
        id: "t",
        type: "text.note",
        semantic: { text: "one two three four five six seven eight nine" },
        visual: { x: 0, y: 0, width: 100, height: 100 },
      }),
    ]);
    // 84 units of text width at 13 * 0.55 per glyph is 11 characters.
    expect(svg).toContain(">one two </text>");
    expect(svg).toContain(">three four </text>");
    expect(svg).toContain(">five six </text>");
    expect(svg).not.toContain(">one two three</text>");
  });

  test("a text note clips lines that do not fit its height", () => {
    const svg = pageSvg([
      element({
        id: "t",
        type: "text.note",
        semantic: { text: "a\nb\nc\nd" },
        visual: { x: 0, y: 0, width: 200, height: 40 },
      }),
    ]);
    // Two lines of 15.6 after the 6 unit inset fit in 40; a third would not.
    expect(svg).toContain(">a</text>");
    expect(svg).toContain(">b</text>");
    expect(svg).not.toContain(">c</text>");
  });

  test("a text note paints a fill rect only when it has a fill", () => {
    const svg = pageSvg([
      element({
        id: "t",
        type: "text.note",
        semantic: { text: "x" },
        visual: {
          x: 0,
          y: 0,
          width: 200,
          height: 60,
          style: { fill: "#fff1c9", color: "#123456", textAlign: "end" },
        },
      }),
    ]);
    expect(svg).toContain(
      '<rect x="0" y="0" width="200" height="60" fill="#fff1c9" stroke="none" />',
    );
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain('x="192"');
    expect(svg).toContain('fill="#123456"');
  });

  test("a text note preserves rich marks and safe links", () => {
    const svg = pageSvg([
      element({
        id: "rich",
        type: "text.note",
        semantic: {
          text: "Bold italic code link",
          marks: [
            { start: 0, end: 4, kind: "bold" },
            { start: 5, end: 11, kind: "italic" },
            { start: 12, end: 16, kind: "code" },
            { start: 17, end: 21, kind: "link", href: "https://diagra.app" },
          ],
        },
        visual: { x: 0, y: 0, width: 300, height: 40 },
      }),
    ]);
    expect(svg).toContain('<tspan font-weight="700">Bold</tspan>');
    expect(svg).toContain('<tspan font-style="italic">italic</tspan>');
    expect(svg).toContain("ui-monospace");
    expect(svg).toContain(
      '<a href="https://diagra.app" rel="noopener noreferrer"><tspan text-decoration="underline"',
    );
  });

  test("an empty text note still occupies its bounds", () => {
    const svg = pageSvg([
      element({
        id: "t",
        type: "text.note",
        semantic: { text: "" },
        visual: { x: 10, y: 10, width: 100, height: 40 },
      }),
    ]);
    expect(svg).toContain('viewBox="-6 -6 132 72"');
    expect(svg).not.toContain("<text");
  });

  test("a group wraps its members without drawing geometry of its own", () => {
    const svg = pageSvg([
      geo("a", "rect"),
      element({
        id: "grp",
        type: "group",
        index: "b2",
        semantic: { memberIds: ["a"] },
        visual: {},
      }),
    ]);
    expect(svg).toContain('data-id="a"');
    expect(svg).toContain('data-id="grp" data-type="group"');
    expect(svg?.indexOf('data-id="a"')).toBeGreaterThan(
      svg?.indexOf('data-id="grp"') ?? -1,
    );
    expect(svg).not.toContain("unsupported: group");
  });

  test("an unmodelled type becomes a labelled dashed placeholder", () => {
    const svg = pageSvg([
      element({
        id: "n",
        type: "future.widget",
        semantic: { name: "later" },
        visual: { x: 0, y: 0 },
      }),
    ]);
    expect(svg).toContain('stroke-dasharray="6 4"');
    expect(svg).toContain(">unsupported: future.widget</text>");
  });

  test("an element with no geometry contributes nothing", () => {
    const store = new Store(
      document([
        element({
          id: "floating",
          type: "future.widget",
          semantic: { name: "later" },
          visual: {},
        }),
      ]),
    );
    expect(renderPageSvg(store, registry, TEST_PAGE.id)).toBeNull();
  });
});

describe("visual styling", () => {
  test("fill, stroke geometry, dash and opacity reach the primary shape", () => {
    const svg = pageSvg([
      geo("g", "rect", {
        style: {
          fill: "#ff0000",
          stroke: "#00ff00",
          strokeWidth: 3,
          strokeCap: "square",
          strokeJoin: "bevel",
          strokeMiterLimit: 6,
          dash: "dotted",
          opacity: 0.25,
        },
      }),
    ]);
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('stroke="#00ff00"');
    expect(svg).toContain('stroke-width="3"');
    expect(svg).toContain('stroke-linecap="square"');
    expect(svg).toContain('stroke-linejoin="bevel"');
    expect(svg).toContain('stroke-miterlimit="6"');
    expect(svg).toContain('stroke-dasharray="1 4"');
    expect(svg).toContain('opacity="0.25"');
  });

  test("a solid dash means no dash array at all", () => {
    const svg = pageSvg([geo("g", "rect", { style: { dash: "solid" } })]);
    expect(svg).not.toContain("stroke-dasharray");
  });

  test("colour, size and alignment reach the label", () => {
    const svg = pageSvg([
      element({
        id: "g",
        type: "shape.geo",
        semantic: { geo: "rect", label: "left" },
        visual: {
          x: 0,
          y: 0,
          width: 160,
          height: 100,
          style: { color: "#123456", fontSize: 20, textAlign: "start" },
        },
      }),
    ]);
    expect(svg).toContain('text-anchor="start"');
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('font-size="20"');
    // Anchored at the left inset rather than the centre of the box.
    expect(svg).toContain('x="8"');
  });

  test("rotation becomes a transform about the element's own centre", () => {
    const svg = pageSvg([geo("g", "rect", { rotation: 45 })]);
    expect(svg).toContain(
      '<g data-id="g" data-type="shape.geo" transform="rotate(45 80 50)">',
    );
  });

  test("a zero rotation adds no transform", () => {
    const svg = pageSvg([geo("g", "rect", { rotation: 0 })]);
    expect(svg).toContain('<g data-id="g" data-type="shape.geo">');
  });
});

describe("wrapTextLines", () => {
  test("keeps short text on one line", () => {
    expect(wrapTextLines("hello", 200, 13)).toEqual(["hello"]);
  });

  test("breaks at explicit newlines, keeping blank lines", () => {
    expect(wrapTextLines("a\n\nb", 200, 13)).toEqual(["a", "", "b"]);
  });

  test("wraps greedily at word boundaries", () => {
    // 10 characters per line at 13 * 0.55 = 7.15 units each: 71.5 wide.
    expect(wrapTextLines("aaa bbb ccc ddd", 72, 13)).toEqual([
      "aaa bbb ",
      "ccc ddd",
    ]);
  });

  test("splits a word longer than a line", () => {
    expect(wrapTextLines("abcdefghijklmnop", 72, 13)).toEqual([
      "abcdefghij",
      "klmnop",
    ]);
  });

  test("never divides by a zero width", () => {
    expect(wrapTextLines("ab cd", 0, 13)).toEqual(["a", "b", " ", "c", "d"]);
  });
});

describe("selection export", () => {
  test("artboard assets use exact dimensions, suppress root titles and clip overflow", () => {
    const editor = makeEditor();
    const child = editor.buildElement("text.note", {
      semantic: { text: "AssetLabel" },
      visual: { x: 100, y: 150, width: 200, height: 40 },
    });
    const frame = editor.buildElement("frame", {
      semantic: { name: "Editor-only title", memberIds: [child.id] },
      visual: { x: 100, y: 100, width: 390, height: 844 },
    });
    editor.apply([
      { type: "createElement", element: frame },
      {
        type: "createElement",
        element: { ...child, index: editor.nextIndex() },
      },
    ]);
    const before = JSON.stringify(editor.getSnapshot());
    const svg = editor.exportArtboardSvg(frame.id, { padding: 99 }) ?? "";
    expect(svg).toContain('width="390" height="844"');
    expect(svg).toContain('viewBox="100 100 390 844"');
    expect(svg).toContain('overflow="hidden"');
    expect(svg).toContain("AssetLabel");
    expect(svg).not.toContain("Editor-only title");
    expect(JSON.stringify(editor.getSnapshot())).toBe(before);
    editor.apply([
      { type: "updateVisual", id: child.id, visual: { width: 900 } },
    ]);
    expect(editor.exportArtboardSvg(frame.id)).toContain(
      'viewBox="100 100 390 844"',
    );
  });

  test("artboard assets reject non-artboards and hidden roots while exporting rotation", () => {
    const editor = makeEditor();
    const frame = editor.buildElement("frame", {
      visual: { x: 0, y: 0, width: 100, height: 50 },
    });
    const shape = editor.buildElement("shape.geo");
    editor.apply([
      { type: "createElement", element: frame },
      { type: "createElement", element: shape },
    ]);
    expect(editor.exportArtboardSvg(shape.id)).toBeNull();
    expect(editor.exportArtboardSvg("missing")).toBeNull();
    editor.apply([
      { type: "updateVisual", id: frame.id, visual: { rotation: 90 } },
    ]);
    expect(editor.exportArtboardSvg(frame.id)).toContain(
      'viewBox="25 -25 50 100"',
    );
    editor.apply([
      {
        type: "updateVisual",
        id: frame.id,
        visual: { hidden: true },
      },
    ]);
    expect(editor.exportArtboardSvg(frame.id)).toBeNull();
  });

  test("selected artboards include nested groups and shapes without unrelated content", () => {
    const editor = makeEditor({
      document: document([
        element({
          id: "screen",
          type: "frame",
          index: "a0",
          semantic: {
            name: "Screen",
            memberIds: ["nested"],
            clipContent: true,
          },
          visual: { x: 0, y: 0, width: 400, height: 800 },
        }),
        element({
          id: "nested",
          type: "frame",
          index: "a1",
          semantic: { name: "Card", memberIds: ["group"] },
          visual: { x: 20, y: 20, width: 200, height: 200 },
        }),
        element({
          id: "group",
          type: "group",
          index: "a2",
          semantic: { memberIds: ["label", "hidden"] },
        }),
        element({
          id: "label",
          type: "text.note",
          index: "a3",
          semantic: { text: "Exported label" },
          visual: { x: 30, y: 30, width: 180, height: 40 },
        }),
        element({
          id: "hidden",
          type: "text.note",
          index: "a4",
          semantic: { text: "Hidden label" },
          visual: { x: 30, y: 80, width: 100, height: 40, hidden: true },
        }),
        element({
          id: "outside",
          type: "text.note",
          index: "a5",
          semantic: { text: "Unrelated" },
          visual: { x: 900, y: 0, width: 100, height: 40 },
        }),
      ]),
    });
    editor.selection.set(["screen", "label"]);
    const before = JSON.stringify(editor.getSnapshot());
    const svg = editor.exportSelectionSvg() ?? "";
    for (const id of ["screen", "nested", "label"])
      expect(occurrences(svg, `data-id="${id}"`)).toBe(1);
    expect(svg).toContain("Exported label");
    expect(svg).toContain("clip-path");
    expect(svg).not.toContain("Hidden label");
    expect(svg).not.toContain("Unrelated");
    expect(JSON.stringify(editor.getSnapshot())).toBe(before);
    expect([...editor.selection.ids()]).toEqual(["screen", "label"]);
    editor.selection.set(["group"]);
    expect(editor.exportSelectionSvg()).toContain("Exported label");
    expect(editor.exportSelectionSvg()).not.toContain('data-id="screen"');
  });

  test("exports only what was selected", () => {
    const store = new Store(document([...erdFixture()]));
    const svg = renderSelectionSvg(
      store,
      registry,
      TEST_PAGE.id,
      new Set(["users"]),
    ) as string;
    expect(svg).toContain('data-id="users"');
    expect(svg).not.toContain('data-id="orders"');
  });

  test("a connector with only one end selected is left out", () => {
    const store = new Store(document([...erdFixture()]));
    const svg = renderSelectionSvg(
      store,
      registry,
      TEST_PAGE.id,
      new Set(["users", "rel"]),
    ) as string;
    expect(svg).toContain('data-id="users"');
    expect(svg).not.toContain('data-id="rel"');
  });

  test("a connector with both ends selected comes along", () => {
    const store = new Store(document([...erdFixture()]));
    const svg = renderSelectionSvg(
      store,
      registry,
      TEST_PAGE.id,
      new Set(["users", "orders", "rel"]),
    ) as string;
    expect(svg).toContain('data-id="rel"');
  });

  test("a selection that trims to nothing exports nothing", () => {
    const store = new Store(document([...erdFixture()]));
    expect(
      renderSelectionSvg(store, registry, TEST_PAGE.id, new Set(["rel"])),
    ).toBeNull();
    expect(
      renderSelectionSvg(store, registry, TEST_PAGE.id, new Set()),
    ).toBeNull();
  });
});

describe("renderElementsSvg", () => {
  test("draws the elements it is handed, in the order it is handed them", () => {
    const store = new Store(document([...erdFixture()]));
    const context = createShapeContext(store, registry, 1);
    const svg = renderElementsSvg(
      [store.get("orders") as Element, store.get("users") as Element],
      registry,
      context,
    ) as string;
    expect(svg.indexOf('data-id="orders"')).toBeLessThan(
      svg.indexOf('data-id="users"'),
    );
  });

  test("nothing in, nothing out", () => {
    const store = new Store(document([]));
    expect(
      renderElementsSvg([], registry, createShapeContext(store, registry, 1)),
    ).toBeNull();
  });
});

describe("editor helpers", () => {
  test("the editor exports its current page and its selection", () => {
    const editor = makeEditor({ document: document([...erdFixture()]) });
    const page = editor.exportPageSvg() as string;
    expect(page).toContain('data-id="orders"');

    editor.selection.set(["users"]);
    const selection = editor.exportSelectionSvg() as string;
    expect(selection).toContain('data-id="users"');
    expect(selection).not.toContain('data-id="orders"');

    editor.selection.clear();
    expect(editor.exportSelectionSvg()).toBeNull();
  });

  test("export options are passed straight through", () => {
    const editor = makeEditor({ document: document([...erdFixture()]) });
    expect(editor.exportPageSvg({ padding: 0 })).toContain('viewBox="0 0');
  });
});
