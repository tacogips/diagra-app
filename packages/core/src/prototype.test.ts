import { expect, test } from "bun:test";
import type { FrameSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import {
  prototypeDelayedLink,
  prototypeScreen,
  prototypeSmartPlan,
  prototypeSmartPlanBetween,
  prototypeSmartSteps,
} from "./prototype.ts";
import { makeEditor } from "./test-helpers.ts";
import { Editor } from "./editor.ts";

for (const type of ["edge.generic", "erd.relation", "uml.association"]) {
  test(`preview retains internal ${type} connectors without explicit edge membership`, () => {
    const editor = makeEditor();
    const nodeType =
      type === "erd.relation"
        ? "erd.table"
        : type === "uml.association"
          ? "uml.class"
          : "node.generic";
    const first = editor.buildElement(nodeType, { visual: { x: 20, y: 20 } });
    const second = editor.buildElement(nodeType, { visual: { x: 220, y: 20 } });
    const frame = editor.buildElement("frame", {
      semantic: {
        name: "Engineering screen",
        memberIds: [first.id, second.id],
      },
      visual: { x: 0, y: 0, width: 800, height: 600 },
    });
    const semantic =
      type === "erd.relation"
        ? {
            from: { table: first.id },
            to: { table: second.id },
            cardinality: "1:*",
          }
        : {
            from: first.id,
            to: second.id,
            ...(type === "uml.association" ? { kind: "assoc" } : {}),
          };
    const edge = editor.buildElement(type, { semantic });
    const navigation = editor.buildElement("edge.generic", {
      semantic: { from: first.id, to: frame.id, prototype: true },
    });
    editor.apply(
      [frame, first, second, edge, navigation].map((element) => ({
        type: "createElement" as const,
        element,
      })),
    );
    const before = editor.getSnapshot();
    expect(
      prototypeScreen(editor, frame.id)?.elements.map((item) => item.id),
    ).toContain(edge.id);
    expect(
      prototypeScreen(editor, frame.id)?.elements.map((item) => item.id),
    ).not.toContain(navigation.id);
    expect(editor.getSnapshot()).toEqual(before);
    expect(parseDocument(serializeDocument(before))).toEqual(before);
    editor.apply([
      { type: "updateVisual", id: second.id, visual: { hidden: true } },
    ]);
    expect(
      prototypeScreen(editor, frame.id)?.elements.map((item) => item.id),
    ).not.toContain(edge.id);
    editor.undo();
    expect(
      prototypeScreen(editor, frame.id)?.elements.map((item) => item.id),
    ).toContain(edge.id);
    editor.apply([
      {
        type: "updateSemantic",
        id: frame.id,
        semantic: { name: "Engineering screen", memberIds: [first.id] },
      },
    ]);
    expect(
      prototypeScreen(editor, frame.id)?.elements.map((item) => item.id),
    ).not.toContain(edge.id);
  });
}

test("rotated hotspots retain their pivot and page-space clip", () => {
  const editor = makeEditor();
  const button = editor.buildElement("shape.geo", {
    visual: { x: 100, y: 100, width: 200, height: 40, rotation: 90 },
  });
  const start = editor.buildElement("frame", {
    semantic: { name: "Clipped", clipContent: true, memberIds: [button.id] },
    visual: { x: 170, y: 0, width: 60, height: 80 },
  });
  const end = editor.buildElement("frame", {
    semantic: { name: "Next", memberIds: [] },
  });
  const edge = editor.buildElement("edge.generic", {
    semantic: { from: button.id, to: end.id, prototype: true },
  });
  editor.apply(
    [button, start, end, edge].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const before = editor.getSnapshot();
  const screen = prototypeScreen(editor, start.id);
  expect(screen?.links).toHaveLength(1);
  expect(screen?.links[0]?.box).toEqual({
    x: 100,
    y: 100,
    width: 200,
    height: 40,
  });
  expect(screen?.links[0]?.rotation).toBe(90);
  expect(screen?.links[0]?.clip).toEqual({
    x: 170,
    y: 0,
    width: 60,
    height: 80,
  });
  expect(editor.getSnapshot()).toEqual(before);
  editor.apply([
    { type: "updateVisual", id: button.id, visual: { rotation: 0 } },
  ]);
  expect(prototypeScreen(editor, start.id)?.links).toEqual([]);
});

test("off-screen and empty diagonal-corner hotspots are omitted", () => {
  const editor = makeEditor();
  const button = editor.buildElement("shape.geo", {
    visual: { x: 100, y: 100, width: 200, height: 40, rotation: 45 },
  });
  const start = editor.buildElement("frame", {
    semantic: { name: "Corner", memberIds: [button.id] },
    visual: { x: 115, y: 195, width: 5, height: 5 },
  });
  const end = editor.buildElement("frame", {
    semantic: { name: "Next", memberIds: [] },
  });
  const edge = editor.buildElement("edge.generic", {
    semantic: { from: button.id, to: end.id, prototype: true },
  });
  editor.apply(
    [button, start, end, edge].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  expect(prototypeScreen(editor, start.id)?.links).toEqual([]);
});

test("scrolling screens retain reachable off-viewport hotspots by enabled axis", () => {
  const editor = makeEditor();
  const below = editor.buildElement("node.generic", {
    semantic: { label: "Below" },
    visual: { x: 20, y: 900, width: 100, height: 40 },
  });
  const right = editor.buildElement("node.generic", {
    semantic: { label: "Right" },
    visual: { x: 500, y: 20, width: 100, height: 40 },
  });
  const target = editor.buildElement("frame", {
    semantic: { name: "Target", memberIds: [] },
  });
  const screen = editor.buildElement("frame", {
    semantic: {
      name: "Scrollable",
      memberIds: [below.id, right.id],
      prototypeOverflow: "vertical",
      clipContent: true,
    },
    visual: { x: 0, y: 0, width: 390, height: 844 },
  });
  const belowLink = editor.buildElement("edge.generic", {
    semantic: { from: below.id, to: target.id, prototype: true },
  });
  const rightLink = editor.buildElement("edge.generic", {
    semantic: { from: right.id, to: target.id, prototype: true },
  });
  editor.apply(
    [below, right, target, screen, belowLink, rightLink].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  expect(
    prototypeScreen(editor, screen.id)?.links.map((link) => link.from),
  ).toEqual([below.id]);
  editor.apply([
    {
      type: "updateSemantic",
      id: screen.id,
      semantic: {
        ...(screen.semantic as FrameSemantic),
        prototypeOverflow: "both",
      },
    },
  ]);
  expect(
    prototypeScreen(editor, screen.id)
      ?.links.map((link) => link.from)
      .sort(),
  ).toEqual([below.id, right.id].sort());
});

test("prototype hotspots resolve without mutating the editor and survive JSONL", () => {
  const editor = makeEditor();
  const button = editor.buildElement("node.generic", {
    semantic: { label: "Continue" },
    visual: { x: 20, y: 20, width: 100, height: 40 },
  });
  const start = editor.buildElement("frame", {
    semantic: { name: "Start", memberIds: [button.id] },
    visual: { x: 0, y: 0, width: 390, height: 844 },
  });
  const end = editor.buildElement("frame", {
    semantic: { name: "Done", memberIds: [] },
    visual: { x: 500, y: 0, width: 390, height: 844 },
  });
  const edge = editor.buildElement("edge.generic", {
    semantic: {
      from: button.id,
      to: end.id,
      prototype: true,
      label: "Continue",
      prototypeTrigger: "after-delay",
      prototypeDelay: 750,
      prototypeTransition: "smart",
      prototypeDuration: 420,
    },
  });
  editor.apply(
    [button, start, end, edge].map((element) => ({
      type: "createElement",
      element,
    })),
  );
  const before = editor.getSnapshot();
  const screen = prototypeScreen(editor, start.id);
  expect(screen?.links).toHaveLength(1);
  expect(screen?.links[0]?.to).toBe(end.id);
  expect(screen?.links[0]?.trigger).toBe("after-delay");
  expect(screen?.links[0]?.delay).toBe(750);
  expect(screen?.links[0]?.transition).toBe("smart");
  expect(screen?.links[0]?.duration).toBe(420);
  expect(screen?.elements.some((item) => item.id === button.id)).toBe(true);
  expect(screen?.elements.some((item) => item.id === end.id)).toBe(false);
  expect(editor.getSnapshot()).toEqual(before);
  expect(parseDocument(serializeDocument(before))).toEqual(before);
  editor.deleteElements([end.id]);
  expect(prototypeScreen(editor, start.id)?.links).toEqual([]);
  editor.undo();
  expect(prototypeScreen(editor, start.id)?.links).toHaveLength(1);
  editor.apply([
    { type: "updateVisual", id: button.id, visual: { hidden: true } },
  ]);
  expect(prototypeScreen(editor, start.id)?.links).toEqual([]);
});

test("prototype hotspots supply stable animation defaults", () => {
  const editor = makeEditor();
  const source = editor.buildElement("node.generic", {
    semantic: { label: "Open" },
  });
  const start = editor.buildElement("frame", {
    semantic: { name: "Start", memberIds: [source.id] },
  });
  const end = editor.buildElement("frame", {
    semantic: { name: "End", memberIds: [] },
  });
  const edge = editor.buildElement("edge.generic", {
    semantic: { from: source.id, to: end.id, prototype: true },
  });
  editor.apply(
    [source, start, end, edge].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  expect(prototypeScreen(editor, start.id)?.links[0]).toMatchObject({
    action: "navigate",
    trigger: "click",
    delay: 1000,
    transition: "instant",
    duration: 250,
  });
});

test("prototype hotspots inherit accessible names, roles, and disabled state", () => {
  const editor = makeEditor();
  const source = editor.buildElement("text.note", {
    semantic: { text: "Open" },
    accessibility: {
      role: "link",
      label: "Open account details",
      disabled: true,
    },
    visual: { x: 20, y: 20, width: 120, height: 44 },
  });
  const start = editor.buildElement("frame", {
    semantic: { name: "Start", memberIds: [source.id] },
    visual: { x: 0, y: 0, width: 320, height: 640 },
  });
  const end = editor.buildElement("frame", {
    semantic: { name: "End", memberIds: [] },
    visual: { x: 400, y: 0, width: 320, height: 640 },
  });
  const edge = editor.buildElement("edge.generic", {
    semantic: {
      from: source.id,
      to: end.id,
      prototype: true,
      prototypeTrigger: "after-delay",
    },
  });
  editor.apply(
    [start, source, end, edge].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const link = prototypeScreen(editor, start.id)?.links[0];
  expect(link).toMatchObject({
    label: "Open account details",
    role: "link",
    disabled: true,
  });
  expect(prototypeDelayedLink(link ? [link] : [])).toBeUndefined();
});

test("prototype keyboard order follows explicit artboard hierarchy", () => {
  const editor = makeEditor();
  const first = editor.buildElement("node.generic", {
    id: "visual-first",
    semantic: { label: "First" },
    visual: { x: 20, y: 20, width: 100, height: 44 },
  });
  const second = editor.buildElement("node.generic", {
    id: "visual-second",
    semantic: { label: "Second" },
    visual: { x: 20, y: 80, width: 100, height: 44 },
  });
  const start = editor.buildElement("frame", {
    semantic: { name: "Start", memberIds: [second.id, first.id] },
    visual: { x: 0, y: 0, width: 320, height: 640 },
  });
  const end = editor.buildElement("frame", {
    semantic: { name: "End", memberIds: [] },
    visual: { x: 400, y: 0, width: 320, height: 640 },
  });
  const firstLink = editor.buildElement("edge.generic", {
    id: "a-first-link",
    semantic: { from: first.id, to: end.id, prototype: true },
  });
  const secondLink = editor.buildElement("edge.generic", {
    id: "z-second-link",
    semantic: { from: second.id, to: end.id, prototype: true },
  });
  editor.apply(
    [start, first, second, end, firstLink, secondLink].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  expect(
    prototypeScreen(editor, start.id)?.links.map((link) => link.from),
  ).toEqual([second.id, first.id]);
});

test("component-state hotspots target only compatible variants without mutating the document", () => {
  const editor = makeEditor();
  const normal = editor.buildElement("frame", {
    semantic: {
      name: "Button default",
      component: true,
      variantSet: "Button",
      variantName: "Default",
      memberIds: [],
    },
    visual: { x: 500, y: 0, width: 120, height: 44 },
  });
  const hover = editor.buildElement("frame", {
    semantic: {
      name: "Button hover",
      component: true,
      variantSet: "Button",
      variantName: "Hover",
      memberIds: [],
    },
    visual: { x: 650, y: 0, width: 120, height: 44 },
  });
  const unrelated = editor.buildElement("frame", {
    semantic: {
      name: "Card",
      component: true,
      variantSet: "Card",
      memberIds: [],
    },
    visual: { x: 800, y: 0, width: 120, height: 44 },
  });
  editor.apply(
    [normal, hover, unrelated].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const instance = editor.createComponentInstance(normal.id, { x: 20, y: 20 });
  if (!instance) throw new Error("missing component instance");
  const screen = editor.buildElement("frame", {
    semantic: { name: "Screen", memberIds: [instance] },
    visual: { x: 0, y: 0, width: 390, height: 844 },
  });
  const link = editor.buildElement("edge.generic", {
    semantic: {
      from: instance,
      to: hover.id,
      prototype: true,
      prototypeAction: "change-to",
      prototypeTrigger: "hover",
      prototypeTransition: "smart",
    },
  });
  editor.apply([
    { type: "createElement", element: screen },
    { type: "createElement", element: link },
  ]);
  const before = editor.getSnapshot();
  expect(prototypeScreen(editor, screen.id)?.links[0]).toMatchObject({
    from: instance,
    to: hover.id,
    action: "change-to",
    trigger: "hover",
    label: "Change component state",
  });
  expect(editor.getSnapshot()).toEqual(before);
  editor.apply([
    {
      type: "updateSemantic",
      id: link.id,
      semantic: {
        ...(link.semantic as object),
        to: unrelated.id,
      },
    },
  ]);
  expect(prototypeScreen(editor, screen.id)?.links).toEqual([]);
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
});

test("overlay actions resolve presentation defaults and close controls", () => {
  const editor = makeEditor();
  const opener = editor.buildElement("shape.geo", {
    visual: {
      x: 20,
      y: 20,
      width: 120,
      height: 44,
      prototypeFixed: true,
    },
  });
  const closer = editor.buildElement("shape.geo", {
    visual: { x: 640, y: 180, width: 80, height: 36 },
  });
  const base = editor.buildElement("frame", {
    semantic: {
      name: "Base",
      memberIds: [opener.id],
      prototypeOverflow: "vertical",
    },
    visual: { x: 0, y: 0, width: 390, height: 844 },
  });
  const overlay = editor.buildElement("frame", {
    semantic: { name: "Menu", memberIds: [closer.id] },
    visual: { x: 600, y: 100, width: 300, height: 400 },
  });
  const open = editor.buildElement("edge.generic", {
    semantic: {
      from: opener.id,
      to: overlay.id,
      prototype: true,
      prototypeAction: "open-overlay",
      prototypeOverlayPosition: "manual",
      prototypeOverlayX: 24,
      prototypeOverlayY: 80,
      prototypeOverlayBackdrop: true,
      prototypeOverlayDismiss: true,
    },
  });
  const close = editor.buildElement("edge.generic", {
    semantic: {
      from: closer.id,
      to: overlay.id,
      prototype: true,
      prototypeAction: "close-overlay",
    },
  });
  editor.apply(
    [opener, closer, base, overlay, open, close].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  expect(prototypeScreen(editor, base.id)?.links[0]).toMatchObject({
    action: "open-overlay",
    label: "Open overlay",
    overlayPosition: "manual",
    overlayX: 24,
    overlayY: 80,
    overlayBackdrop: true,
    overlayDismiss: true,
  });
  expect(prototypeScreen(editor, overlay.id)?.links[0]).toMatchObject({
    action: "close-overlay",
    label: "Close overlay",
    overlayPosition: "center",
    overlayX: 0,
    overlayY: 0,
    overlayBackdrop: false,
    overlayDismiss: false,
  });
  expect(parseDocument(serializeDocument(editor.getSnapshot()))).toEqual(
    editor.getSnapshot(),
  );
  expect(editor.undo()).toBe(true);
  expect(prototypeScreen(editor, base.id)).toBeNull();
  expect(editor.redo()).toBe(true);
  expect(
    (editor.store.get(base.id)?.semantic as FrameSemantic).prototypeOverflow,
  ).toBe("vertical");
  expect(editor.store.get(opener.id)?.visual.prototypeFixed).toBe(true);
  editor.apply([
    { type: "updateVisual", id: overlay.id, visual: { hidden: true } },
  ]);
  expect(prototypeScreen(editor, base.id)?.links).toEqual([]);
});

test("smart animation compares transient component states by reused IDs", () => {
  const editor = makeEditor();
  const normalLabel = editor.buildElement("text.note", {
    semantic: { text: "Normal" },
    visual: {
      x: 510,
      y: 10,
      width: 80,
      height: 24,
      componentKey: "label",
      style: { color: "#111111" },
    },
  });
  const hoverLabel = editor.buildElement("text.note", {
    semantic: { text: "Hover" },
    visual: {
      x: 670,
      y: 12,
      width: 90,
      height: 24,
      componentKey: "label",
      style: { color: "#ffffff" },
    },
  });
  const normal = editor.buildElement("frame", {
    semantic: {
      name: "Default",
      component: true,
      variantSet: "Button",
      memberIds: [normalLabel.id],
    },
    visual: { x: 500, y: 0, width: 120, height: 44 },
  });
  const hover = editor.buildElement("frame", {
    semantic: {
      name: "Hover",
      component: true,
      variantSet: "Button",
      memberIds: [hoverLabel.id],
    },
    visual: { x: 650, y: 0, width: 130, height: 48 },
  });
  editor.apply(
    [normal, normalLabel, hover, hoverLabel].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const instance = editor.createComponentInstance(normal.id, { x: 20, y: 20 });
  if (!instance) throw new Error("missing component instance");
  const targetLabel = (editor.store.get(instance)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!targetLabel) throw new Error("missing instance label");
  const screen = editor.buildElement("frame", {
    semantic: { name: "Screen", memberIds: [instance] },
    visual: { x: 0, y: 0, width: 390, height: 844 },
  });
  editor.apply([{ type: "createElement", element: screen }]);
  const authored = editor.getSnapshot();
  const before = new Editor({
    document: editor.getSnapshot(),
    registry: editor.registry,
  });
  const runtime = new Editor({
    document: editor.getSnapshot(),
    registry: editor.registry,
  });
  expect(runtime.switchComponentVariant(instance, hover.id)).toBe(true);
  const plan = prototypeSmartPlanBetween(before, runtime, screen.id);
  expect(plan.steps.find((step) => step.target === targetLabel)).toMatchObject({
    target: targetLabel,
    fadeIn: false,
    paintFrom: { color: "#111111" },
    paintTo: { color: "#ffffff" },
  });
  expect(editor.getSnapshot()).toEqual(authored);
});

test("automatic prototype routes choose the earliest delay deterministically", () => {
  const links = [
    { id: "z", trigger: "after-delay" as const, delay: 500 },
    { id: "b", trigger: "click" as const, delay: 100 },
    { id: "a", trigger: "after-delay" as const, delay: 500 },
    { id: "later", trigger: "after-delay" as const, delay: 900 },
  ];
  expect(prototypeDelayedLink(links)?.id).toBe("a");
  expect(
    prototypeDelayedLink(links.filter((link) => link.id !== "a"))?.id,
  ).toBe("z");
  expect(
    prototypeDelayedLink(links.filter((link) => link.trigger === "click")),
  ).toBeUndefined();
  expect(links.map((link) => link.id)).toEqual(["z", "b", "a", "later"]);
});

test("smart animation matches unique keyed layers in screen-relative geometry", () => {
  const editor = makeEditor();
  const sourceHero = editor.buildElement("shape.geo", {
    visual: {
      x: 120,
      y: 240,
      width: 100,
      height: 50,
      rotation: 350,
      componentKey: "hero",
      style: {
        opacity: 0.4,
        fill: "#ff0000",
        stroke: "#111111",
        strokeWidth: 1,
        cornerRadius: 4,
        color: "#222222",
        fontSize: 12,
        fontWeight: 400,
        lineHeight: 1.2,
        letterSpacing: 0,
        effects: [
          {
            type: "drop-shadow",
            x: 0,
            y: 2,
            blur: 3,
            color: "#000000",
            opacity: 0.2,
          },
          { type: "background-blur", blur: 4 },
        ],
      },
    },
  });
  const sourceFrame = editor.buildElement("frame", {
    semantic: { name: "Source", memberIds: [sourceHero.id] },
    visual: { x: 100, y: 200, width: 400, height: 300 },
  });
  const targetHero = editor.buildElement("shape.geo", {
    visual: {
      x: 1040,
      y: 560,
      width: 200,
      height: 100,
      rotation: 10,
      componentKey: "hero",
      style: {
        opacity: 0.8,
        fill: "#0000ff",
        stroke: "#eeeeee",
        strokeWidth: 3,
        cornerRadii: {
          topLeft: 12,
          topRight: 4,
          bottomRight: 20,
          bottomLeft: 8,
        },
        color: "#ffffff",
        fontSize: 20,
        fontWeight: 700,
        lineHeight: 1.5,
        letterSpacing: 2,
        effects: [
          { type: "layer-blur", blur: 2 },
          { type: "background-blur", blur: 8 },
        ],
      },
    },
  });
  const newLayer = editor.buildElement("text.note", {
    semantic: { text: "New" },
    visual: { x: 1080, y: 700, width: 80, height: 30 },
  });
  const targetFrame = editor.buildElement("frame", {
    semantic: {
      name: "Target",
      memberIds: [targetHero.id, newLayer.id],
    },
    visual: { x: 1000, y: 500, width: 500, height: 400 },
  });
  editor.apply(
    [sourceFrame, sourceHero, targetFrame, targetHero, newLayer].map(
      (element) => ({ type: "createElement" as const, element }),
    ),
  );
  const before = editor.getSnapshot();
  const steps = prototypeSmartSteps(editor, sourceFrame.id, targetFrame.id);
  expect(steps.find((step) => step.target === targetHero.id)).toEqual({
    target: targetHero.id,
    translateX: -70,
    translateY: -45,
    scaleX: 0.5,
    scaleY: 0.5,
    rotateFrom: -10,
    rotateTo: 10,
    opacityFrom: 0.4,
    opacityTo: 0.8,
    filterFrom: "drop-shadow(0px 2px 3px rgba(0, 0, 0, 0.2))",
    filterTo: "blur(2px)",
    backdropFilterFrom: "blur(4px)",
    backdropFilterTo: "blur(8px)",
    paintFrom: {
      fill: "#ff0000",
      stroke: "#111111",
      strokeWidth: 1,
      cornerRadii: {
        topLeft: 4,
        topRight: 4,
        bottomRight: 4,
        bottomLeft: 4,
      },
      color: "#222222",
      fontSize: 12,
      fontWeight: 400,
      lineHeight: 1.2,
      letterSpacing: 0,
    },
    paintTo: {
      fill: "#0000ff",
      stroke: "#eeeeee",
      strokeWidth: 3,
      cornerRadii: {
        topLeft: 12,
        topRight: 4,
        bottomRight: 20,
        bottomLeft: 8,
      },
      color: "#ffffff",
      fontSize: 20,
      fontWeight: 700,
      lineHeight: 1.5,
      letterSpacing: 2,
    },
    fadeIn: false,
  });
  expect(steps.find((step) => step.target === newLayer.id)).toMatchObject({
    rotateFrom: 0,
    rotateTo: 0,
    opacityFrom: 0,
    opacityTo: 1,
    filterFrom: "none",
    filterTo: "none",
    fadeIn: true,
  });
  expect(editor.getSnapshot()).toEqual(before);
});

test("smart animation never guesses across duplicate keys or different types", () => {
  const editor = makeEditor();
  const sourceA = editor.buildElement("shape.geo", {
    visual: { componentKey: "duplicate" },
  });
  const sourceB = editor.buildElement("shape.geo", {
    visual: { x: 200, componentKey: "duplicate" },
  });
  const sourceText = editor.buildElement("text.note", {
    semantic: { text: "Source" },
    visual: { componentKey: "typed" },
  });
  const sourceFrame = editor.buildElement("frame", {
    semantic: {
      name: "Source",
      memberIds: [sourceA.id, sourceB.id, sourceText.id],
    },
  });
  const duplicateTarget = editor.buildElement("shape.geo", {
    visual: { x: 500, componentKey: "duplicate" },
  });
  const wrongType = editor.buildElement("shape.geo", {
    visual: { x: 700, componentKey: "typed" },
  });
  const targetFrame = editor.buildElement("frame", {
    semantic: {
      name: "Target",
      memberIds: [duplicateTarget.id, wrongType.id],
    },
    visual: { x: 500, y: 0 },
  });
  editor.apply(
    [
      sourceFrame,
      sourceA,
      sourceB,
      sourceText,
      targetFrame,
      duplicateTarget,
      wrongType,
    ].map((element) => ({ type: "createElement" as const, element })),
  );
  const steps = prototypeSmartSteps(editor, sourceFrame.id, targetFrame.id);
  expect(steps.find((step) => step.target === duplicateTarget.id)?.fadeIn).toBe(
    true,
  );
  expect(steps.find((step) => step.target === wrongType.id)?.fadeIn).toBe(true);
});

test("smart animation plans compatible gradients and discrete typography", () => {
  const editor = makeEditor();
  const sourceGradient = {
    type: "linear" as const,
    angle: 0,
    stops: [
      { offset: 0, color: "#ff0000" },
      { offset: 1, color: "#0000ff" },
    ],
  };
  const targetGradient = {
    type: "linear" as const,
    angle: 90,
    stops: [
      { offset: 0.2, color: "#00ff00" },
      { offset: 0.8, color: "#ffffff" },
    ],
  };
  const source = editor.buildElement("shape.geo", {
    visual: {
      componentKey: "paint",
      style: {
        fill: "#ff0000",
        fillGradient: sourceGradient,
        strokeCap: "butt",
        strokeJoin: "miter",
        strokeMiterLimit: 4,
        fontFamily: "Inter",
        fontStyle: "normal",
        textAlign: "start",
        textDecoration: "none",
      },
    },
  });
  const sourceFrame = editor.buildElement("frame", {
    semantic: { name: "Source", memberIds: [source.id] },
  });
  const target = editor.buildElement("shape.geo", {
    visual: {
      x: 500,
      componentKey: "paint",
      style: {
        fill: "#0000ff",
        fillGradient: targetGradient,
        strokeCap: "round",
        strokeJoin: "bevel",
        strokeMiterLimit: 8,
        fontFamily: "Georgia",
        fontStyle: "italic",
        textAlign: "middle",
        textDecoration: "underline",
      },
    },
  });
  const targetFrame = editor.buildElement("frame", {
    semantic: { name: "Target", memberIds: [target.id] },
    visual: { x: 500 },
  });
  editor.apply(
    [sourceFrame, source, targetFrame, target].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const step = prototypeSmartSteps(editor, sourceFrame.id, targetFrame.id).find(
    (candidate) => candidate.target === target.id,
  );
  expect(step?.paintFrom).toEqual({
    fillGradient: sourceGradient,
    strokeCap: "butt",
    strokeJoin: "miter",
    strokeMiterLimit: 4,
    fontFamily: "Inter",
    fontStyle: "normal",
    textAlign: "start",
    textDecoration: "none",
  });
  expect(step?.paintTo).toEqual({
    fillGradient: targetGradient,
    strokeCap: "round",
    strokeJoin: "bevel",
    strokeMiterLimit: 8,
    fontFamily: "Georgia",
    fontStyle: "italic",
    textAlign: "middle",
    textDecoration: "underline",
  });
});

test("smart animation skips incompatible gradients and properties missing at either endpoint", () => {
  const editor = makeEditor();
  const source = editor.buildElement("shape.geo", {
    visual: {
      componentKey: "paint",
      style: {
        fill: "#ff0000",
        fillGradient: {
          type: "radial",
          centerX: 0.5,
          centerY: 0.5,
          radius: 0.5,
          stops: [
            { offset: 0, color: "#ff0000" },
            { offset: 1, color: "#0000ff" },
          ],
        },
        stroke: "#111111",
        strokeGradient: {
          type: "linear",
          angle: 0,
          stops: [
            { offset: 0, color: "#111111" },
            { offset: 1, color: "#555555" },
          ],
        },
        fontSize: 12,
      },
    },
  });
  const sourceFrame = editor.buildElement("frame", {
    semantic: { name: "Source", memberIds: [source.id] },
  });
  const target = editor.buildElement("shape.geo", {
    visual: {
      x: 500,
      componentKey: "paint",
      style: {
        fill: "#0000ff",
        fillGradient: {
          type: "linear",
          angle: 0,
          stops: [
            { offset: 0, color: "#000000" },
            { offset: 1, color: "#ffffff" },
          ],
        },
        stroke: "#eeeeee",
        strokeGradient: {
          type: "linear",
          angle: 90,
          stops: [
            { offset: 0, color: "#111111" },
            { offset: 0.5, color: "#777777" },
            { offset: 1, color: "#eeeeee" },
          ],
        },
        letterSpacing: 2,
      },
    },
  });
  const targetFrame = editor.buildElement("frame", {
    semantic: { name: "Target", memberIds: [target.id] },
    visual: { x: 500 },
  });
  editor.apply(
    [sourceFrame, source, targetFrame, target].map((element) => ({
      type: "createElement" as const,
      element,
    })),
  );
  const step = prototypeSmartSteps(editor, sourceFrame.id, targetFrame.id).find(
    (candidate) => candidate.target === target.id,
  );
  expect(step?.paintFrom).toBeUndefined();
  expect(step?.paintTo).toBeUndefined();
});

test("smart animation exits unmatched source layers/connectors but not the source artboard", () => {
  const editor = makeEditor();
  const matchedSource = editor.buildElement("shape.geo", {
    visual: { x: 20, y: 20, componentKey: "hero" },
  });
  const outgoingText = editor.buildElement("text.note", {
    semantic: { text: "Old badge" },
    visual: { x: 160, y: 20 },
  });
  const outgoingConnector = editor.buildElement("edge.generic", {
    semantic: { from: matchedSource.id, to: outgoingText.id },
  });
  const sourceFrame = editor.buildElement("frame", {
    semantic: {
      name: "Source",
      memberIds: [matchedSource.id, outgoingText.id],
    },
    visual: { width: 400, height: 300 },
  });
  const matchedTarget = editor.buildElement("shape.geo", {
    visual: { x: 520, y: 20, componentKey: "hero" },
  });
  const newText = editor.buildElement("text.note", {
    semantic: { text: "New badge" },
    visual: { x: 660, y: 20 },
  });
  const targetFrame = editor.buildElement("frame", {
    semantic: {
      name: "Target",
      memberIds: [matchedTarget.id, newText.id],
    },
    visual: { x: 500, width: 400, height: 300 },
  });
  editor.apply(
    [
      sourceFrame,
      matchedSource,
      outgoingText,
      outgoingConnector,
      targetFrame,
      matchedTarget,
      newText,
    ].map((element) => ({ type: "createElement" as const, element })),
  );
  const before = editor.getSnapshot();
  const plan = prototypeSmartPlan(editor, sourceFrame.id, targetFrame.id);
  expect(plan.outgoing).toEqual([outgoingText.id, outgoingConnector.id]);
  expect(
    plan.steps.find((step) => step.target === matchedTarget.id)?.fadeIn,
  ).toBe(false);
  expect(plan.steps.find((step) => step.target === newText.id)?.fadeIn).toBe(
    true,
  );
  expect(editor.getSnapshot()).toEqual(before);
});
