import { describe, expect, test } from "bun:test";
import { createShapeContext } from "./hit-test.ts";
import { readDirectEndpoints, resolveConnector } from "./shapes/connector.ts";
import { renderPageSvg } from "./svg-export.ts";
import { document, element, makeEditor, TEST_PAGE } from "./test-helpers.ts";

const imported = () =>
  document([
    element({
      id: "browser",
      type: "sequence.participant",
      semantic: { name: "Browser", kind: "actor", order: "a1" },
    }),
    element({
      id: "web",
      type: "sequence.participant",
      semantic: { name: "Web server", kind: "service", order: "a2" },
      visual: { x: 260 },
    }),
    element({
      id: "cache",
      type: "sequence.participant",
      semantic: { name: "Cache", kind: "db", order: "a3" },
    }),
    element({
      id: "get",
      type: "sequence.message",
      semantic: {
        from: "browser",
        to: "web",
        order: "a1",
        kind: "sync",
        label: "GET /dashboard",
      },
    }),
    element({
      id: "lookup",
      type: "sequence.message",
      semantic: {
        from: "web",
        to: "cache",
        order: "a2",
        kind: "sync",
        label: "Cache fetch",
      },
    }),
    element({
      id: "response",
      type: "sequence.message",
      semantic: {
        from: "web",
        to: "browser",
        order: "a3",
        kind: "return",
        label: "200 OK",
      },
    }),
    element({
      id: "activation",
      type: "sequence.activation",
      semantic: { participant: "web", fromOrder: "a1", toOrder: "a3" },
    }),
  ]);

describe("semantic-only imported sequence geometry", () => {
  test("separates participants and timeline rows without changing the document", () => {
    const source = imported();
    const editor = makeEditor({ document: source });
    const before = editor.getSnapshot();
    expect(
      ["browser", "web", "cache"].map((id) => editor.getBounds(id)?.x),
    ).toEqual([0, 260, 480]);
    expect(editor.getBounds("browser")).toMatchObject({
      width: 160,
      height: 328,
    });
    const context = createShapeContext(editor.store, editor.registry, 1);
    const routes = ["get", "lookup", "response"].map(
      (id) =>
        resolveConnector(editor.store.get(id)!, context, readDirectEndpoints)!,
    );
    expect(routes.map((route) => route.start.y)).toEqual([164, 216, 268]);
    expect(routes.every((route) => route.start.y === route.end.y)).toBe(true);
    expect(routes[0]?.start.x).toBe(80);
    expect(routes[0]?.end.x).toBe(340);
    expect(editor.getBounds("activation")).toEqual({
      x: 335,
      y: 164,
      width: 10,
      height: 104,
    });
    expect(editor.getSnapshot()).toEqual(before);
    const svg = renderPageSvg(editor.store, editor.registry, TEST_PAGE.id)!;
    expect(svg).toContain("GET /dashboard");
    expect(svg).toContain("Cache fetch");
    expect(svg).toContain('y1="164"');
    expect(svg).toContain('y1="216"');
    expect(svg).toContain('y1="268"');
  });

  test("continues imported timelines through editing and undo", () => {
    const editor = makeEditor({ document: imported() });
    const before = editor.getSnapshot();
    const activation = editor.createSequenceActivation("web")!;
    expect(editor.getBounds(activation)).toMatchObject({ y: 164, height: 128 });
    editor.undo();
    const message = editor.connectSmart("browser", "cache")!;
    expect(editor.store.get(message)?.visual.y).toBe(320);
    expect(editor.getBounds("cache")?.height).toBeGreaterThan(328);
    editor.undo();
    expect(editor.getSnapshot()).toEqual(before);
    expect(editor.moveSequenceElement("browser", 1)).toBe(true);
    expect(editor.getBounds("browser")?.x).toBe(260);
    expect(editor.getBounds("web")?.x).toBe(0);
    editor.undo();
    expect(editor.getSnapshot()).toEqual(before);
    const participant = editor.createSequenceParticipant("service", {
      x: 800,
      y: 28,
    });
    expect(editor.getBounds(participant)?.height).toBe(328);
  });

  test("keeps explicit participant geometry and message positions", () => {
    const source = imported();
    const editor = makeEditor({
      document: {
        ...source,
        elements: source.elements.map((item) =>
          item.id === "browser"
            ? { ...item, visual: { x: 45, y: 20, width: 180, height: 600 } }
            : item.id === "lookup"
              ? { ...item, visual: { y: 420 } }
              : item,
        ),
      },
    });
    expect(editor.getBounds("browser")).toEqual({
      x: 45,
      y: 20,
      width: 180,
      height: 600,
    });
    expect(editor.getBounds("cache")?.height).toBe(480);
    const context = createShapeContext(editor.store, editor.registry, 1);
    expect(
      resolveConnector(
        editor.store.get("lookup")!,
        context,
        readDirectEndpoints,
      )?.start.y,
    ).toBe(420);
  });
});
