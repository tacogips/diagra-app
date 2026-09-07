import { expect, test } from "bun:test";
import type { FrameSemantic } from "@diagra/ir";
import { parseDocument, serializeDocument } from "@diagra/io";
import { FRAME_PRESETS } from "./shapes/frame.ts";
import { insertUiBlock } from "./ui-blocks.ts";
import { prototypeScreen } from "./prototype.ts";
import { inspectDesign } from "./handoff.ts";
import { makeEditor } from "./test-helpers.ts";

test("mixed design workspace retains responsive screens, prototypes and database semantics", () => {
  const editor = makeEditor();
  const library = editor.currentPageId;
  editor.renamePage(library, "Design library");
  const sourceId = insertUiBlock(editor, "button", { x: 20, y: 20 });
  const sourceLabel = (editor.store.get(sourceId)?.semantic as FrameSemantic)
    .memberIds?.[0];
  if (!sourceLabel) throw new Error("missing source label");
  const screens: {
    page: string;
    frame: string;
    button: string;
    label: string;
  }[] = [];
  for (const profile of ["web", "iphone", "android"] as const) {
    const page = editor.createPage({ name: `${profile} checkout` });
    const preset = FRAME_PRESETS[profile];
    const frame = editor.buildElement("frame", {
      semantic: {
        name: `${profile} checkout`,
        showTitle: false,
        clipContent: true,
        memberIds: [],
        prototypeStart: profile === "web",
      },
      visual: { x: 0, y: 0, width: preset.width, height: preset.height },
    });
    editor.apply([{ type: "createElement", element: frame }]);
    const button = editor.createComponentInstance(sourceId, { x: 24, y: 96 });
    if (!button) throw new Error("missing button instance");
    expect(editor.reparentElement(button, frame.id)).toBe(true);
    const instance = editor.store.get(button)?.semantic as FrameSemantic;
    const label = instance.memberIds?.[0];
    if (!label) throw new Error("missing instance label");
    editor.apply([
      {
        type: "updateSemantic",
        id: button,
        semantic: { ...instance, autoRefresh: true },
      },
      {
        type: "updateVisual",
        id: button,
        visual: { horizontalConstraint: "stretch" },
      },
    ]);
    screens.push({ page, frame: frame.id, button, label });
  }
  const web = screens[0];
  const iphone = screens[1];
  const android = screens[2];
  if (!web || !iphone || !android) throw new Error("missing screens");
  editor.setText(iphone.label, "Pay securely");
  editor.setText(sourceLabel, "Confirm order");
  expect(editor.getText(web.label)).toBe("Confirm order");
  expect(editor.getText(iphone.label)).toBe("Pay securely");
  expect(editor.getText(android.label)).toBe("Confirm order");
  const beforeResize = editor.getSnapshot();
  editor.resizeElement(iphone.frame, { x: 0, y: 0, width: 590, height: 844 });
  expect(editor.getBounds(iphone.button)?.width).toBe(368);
  expect(inspectDesign(editor, iphone.button)?.relativeBounds?.x).toBe(24);
  editor.undo();
  expect(editor.getSnapshot()).toEqual(beforeResize);
  editor.setCurrentPage(web.page);
  const link = editor.buildElement("edge.generic", {
    semantic: {
      from: web.button,
      to: iphone.frame,
      prototype: true,
      label: "Mobile checkout",
    },
  });
  editor.apply([{ type: "createElement", element: link }]);
  expect(prototypeScreen(editor, web.frame)?.links[0]?.to).toBe(iphone.frame);

  const databasePage = editor.createPage({
    name: "Order database",
    kind: "erd",
  });
  const users = editor.buildElement("erd.table", {
    semantic: {
      tableName: "users",
      columns: [{ id: "user-id", name: "id", dataType: "uuid", pk: true }],
    },
    visual: { x: 20, y: 20, width: 240 },
  });
  const orders = editor.buildElement("erd.table", {
    semantic: {
      tableName: "orders",
      columns: [
        { id: "order-id", name: "id", dataType: "uuid", pk: true },
        {
          id: "order-user",
          name: "user_id",
          dataType: "uuid",
          nullable: false,
        },
      ],
    },
    visual: { x: 360, y: 20, width: 240 },
  });
  const relation = editor.buildElement("erd.relation", {
    semantic: {
      from: { table: orders.id, column: "order-user" },
      to: { table: users.id, column: "user-id" },
      cardinality: "*:1",
      label: "placed by",
    },
  });
  editor.apply(
    [users, orders, relation].map((element) => ({
      type: "createElement",
      element,
    })),
  );

  const documentPage = editor.createPage({ name: "Design notes" });
  const paper = editor.buildElement("frame", {
    semantic: { name: "Specification", memberIds: [] },
    visual: {
      x: 0,
      y: 0,
      width: FRAME_PRESETS.paper.width,
      height: FRAME_PRESETS.paper.height,
    },
  });
  const note = editor.buildElement("text.note", {
    semantic: {
      text: "Checkout design\nWeb, iPhone and Android share one order model.",
    },
    visual: { x: 32, y: 48, width: 600, height: 120 },
  });
  editor.apply(
    [paper, note].map((element) => ({ type: "createElement", element })),
  );
  editor.reparentElement(note.id, paper.id);
  const saved = serializeDocument(editor.getSnapshot());
  editor.loadDocument(parseDocument(saved));
  expect(serializeDocument(editor.getSnapshot())).toBe(saved);
  expect(editor.store.get(users.id)?.semantic).toEqual(users.semantic);
  expect(editor.store.get(orders.id)?.semantic).toEqual(orders.semantic);
  expect(editor.store.get(relation.id)?.semantic).toEqual(relation.semantic);
  expect(prototypeScreen(editor, web.frame)?.links[0]?.to).toBe(iphone.frame);
  for (const page of [
    library,
    ...screens.map((screen) => screen.page),
    databasePage,
    documentPage,
  ]) {
    editor.setCurrentPage(page);
    const svg = editor.exportPageSvg();
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("unsupported:");
  }
  editor.setText(sourceLabel, "Place order");
  expect(editor.getText(android.label)).toBe("Place order");
  expect(editor.getText(iphone.label)).toBe("Pay securely");
  expect(editor.store.get(relation.id)?.semantic).toEqual(relation.semantic);
});
