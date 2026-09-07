import { expect, test } from "bun:test";
import { CollabBinding } from "@diagra/collab";
import { Editor, generateDatabaseDdl, prototypeScreen } from "@diagra/core";
import { parseDocument, serializeDocument } from "@diagra/io";
import { type FrameSemantic, validateDocument } from "@diagra/ir";
import * as Y from "yjs";

test("web/mobile design and database work survive synchronization, peer-local undo and JSONL reopen", () => {
  const editor = new Editor();
  const databasePage = editor.currentPageId;
  editor.renamePage(databasePage, "Data model");
  const users = editor.createElement("erd.table", {
    semantic: {
      tableName: "users",
      columns: [{ id: "user-id", name: "id", dataType: "uuid", pk: true }],
    },
    visual: { x: 0, y: 0, width: 280 },
  });
  const orders = editor.createElement("erd.table", {
    semantic: {
      tableName: "orders",
      columns: [
        { id: "order-id", name: "id", dataType: "uuid", pk: true },
        { id: "owner", name: "user_id", dataType: "uuid" },
      ],
    },
    visual: { x: 400, y: 0, width: 280 },
  });
  const relation = editor.createElement("erd.relation", {
    semantic: {
      from: { table: orders, column: "owner" },
      to: { table: users, column: "user-id" },
      cardinality: "*:1",
    },
  });
  const designPage = editor.createPage({ name: "Checkout screens" });
  const action = editor.buildElement("shape.geo", {
    semantic: { geo: "rect", label: "Checkout" },
    visual: {
      x: 20,
      y: 40,
      width: 1400,
      height: 48,
      horizontalConstraint: "stretch",
      style: { fill: "#335c67", cornerRadius: 12 },
    },
  });
  const web = editor.buildElement("frame", {
    semantic: {
      name: "Checkout web",
      platform: "web",
      memberIds: [action.id],
      prototypeStart: true,
    },
    visual: { x: 0, y: 0, width: 1440, height: 900 },
  });
  editor.apply(
    [web, action].map((element) => ({ type: "createElement", element })),
  );
  const iphone = editor.createResponsiveVariant(web.id, "iphone");
  const android = editor.createResponsiveVariant(web.id, "android");
  if (!iphone || !android) throw new Error("Missing mobile variants");
  const link = editor.createElement("edge.generic", {
    semantic: { from: action.id, to: iphone, prototype: true },
  });
  const notesPage = editor.createPage({ name: "Delivery notes" });
  const note = editor.createElement("text.note", {
    semantic: { text: "Checkout uses the orders → users relationship." },
  });
  editor.setCurrentPage(designPage);
  expect(validateDocument(editor.getSnapshot())).toEqual([]);

  const firstDoc = new Y.Doc();
  const first = new CollabBinding({ editor, doc: firstDoc, captureTimeout: 0 });
  first.attach();
  const secondDoc = new Y.Doc();
  Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(firstDoc));
  const remote = new Editor();
  const second = new CollabBinding({
    editor: remote,
    doc: secondDoc,
    captureTimeout: 0,
  });
  second.attach();
  const synchronize = () => {
    for (let round = 0; round < 10; round++) {
      Y.applyUpdate(
        secondDoc,
        Y.encodeStateAsUpdate(firstDoc, Y.encodeStateVector(secondDoc)),
      );
      Y.applyUpdate(
        firstDoc,
        Y.encodeStateAsUpdate(secondDoc, Y.encodeStateVector(firstDoc)),
      );
      if (
        serializeDocument(editor.getSnapshot()) ===
        serializeDocument(remote.getSnapshot())
      )
        return;
    }
    throw new Error("Design peers did not converge");
  };
  try {
    remote.setCurrentPage(databasePage);
    expect(editor.setText(action.id, "Pay now")).toBe(true);
    expect(remote.setText(users, "customers")).toBe(true);
    synchronize();
    expect(first.undo()).toBe(true);
    synchronize();
    expect(editor.getText(action.id)).toBe("Checkout");
    expect(remote.getText(action.id)).toBe("Checkout");
    expect(editor.getText(users)).toBe("customers");
    expect(first.redo()).toBe(true);
    synchronize();
    expect(editor.getText(action.id)).toBe("Pay now");
    expect(editor.currentPageId).toBe(designPage);
    expect(remote.currentPageId).toBe(databasePage);

    const saved = serializeDocument(editor.getSnapshot());
    const reopened = new Editor({ document: parseDocument(saved) });
    expect(serializeDocument(reopened.getSnapshot())).toBe(saved);
    expect(validateDocument(reopened.getSnapshot())).toEqual([]);
    expect(reopened.store.listPages()).toHaveLength(3);
    expect(reopened.store.get(note)?.page).toBe(notesPage);
    expect(reopened.store.get(relation)?.semantic).toEqual(
      editor.store.get(relation)?.semantic,
    );
    expect(reopened.store.get(link)?.semantic).toEqual(
      editor.store.get(link)?.semantic,
    );
    for (const [id, platform, width] of [
      [iphone, "ios", 390],
      [android, "android", 360],
    ] as const) {
      const mobile = reopened.store.get(id);
      expect(mobile?.semantic).toMatchObject({ platform });
      expect(mobile?.visual.width).toBe(width);
      const childId = (mobile?.semantic as FrameSemantic).memberIds?.[0];
      expect(reopened.store.get(childId ?? "")?.visual.width).toBe(width - 40);
      expect(reopened.store.get(childId ?? "")?.visual.style?.fill).toBe(
        "#335c67",
      );
      expect(reopened.exportArtboardSvg(id)).toBe(editor.exportArtboardSvg(id));
      expect(
        prototypeScreen(reopened, id)?.elements.some(
          (element) => element.id === childId,
        ),
      ).toBe(true);
    }
    for (const dialect of ["postgresql", "mysql", "sqlite"] as const) {
      const ddl = generateDatabaseDdl(reopened, databasePage, dialect);
      expect(ddl.tableCount).toBe(2);
      expect(ddl.relationCount).toBe(1);
      expect(ddl.sql).toContain("customers");
      expect(ddl.sql).toContain("FOREIGN KEY");
      expect(ddl).toEqual(generateDatabaseDdl(remote, databasePage, dialect));
    }
    reopened.setCurrentPage(designPage);
    reopened.selection.set([web.id]);
    expect(reopened.exportSelectionSvg()).toContain("Pay now");
    expect(serializeDocument(reopened.getSnapshot())).toBe(saved);
  } finally {
    first.detach();
    second.detach();
    firstDoc.destroy();
    secondDoc.destroy();
  }
});
